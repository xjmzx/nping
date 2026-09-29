// Host checks — the "Hosts" view. Where lib.rs tests one Nostr relay, this
// tests one machine: does its name resolve, does it answer ping, which ports
// are open, is its TLS certificate valid (and for how long), does a web page
// on it answer, and is an LND node on it up. The relay check itself stays in lib.rs; the frontend runs it
// alongside this one when a host has a relay url.
//
// Same rules as the relay probe: blocking I/O with explicit timeouts, run on
// a blocking thread, every failure reported verbatim in the result rather
// than as a rejected command. And no keys: the LND check uses only the REST
// state endpoint, which LND serves without a macaroon.

use std::io::{Read, Write};
use std::net::{IpAddr, SocketAddr, TcpStream, ToSocketAddrs};
use std::process::Command;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{ClientConfig, ClientConnection, DigitallySignedStruct, RootCertStore, SignatureScheme};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const IO_TIMEOUT: Duration = Duration::from_secs(6);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostSpec {
    host: String,
    #[serde(default)]
    icmp: bool,
    #[serde(default)]
    tcp_ports: Vec<u16>,
    tls_port: Option<u16>,
    /// The name to verify the certificate against (and send as SNI) when it
    /// isn't the host — e.g. dialling a box by IP but checking its domain cert.
    tls_name: Option<String>,
    lnd_p2p_port: Option<u16>,
    lnd_rest_port: Option<u16>,
    /// The node's onion address ("xyz.onion" or "xyz.onion:9735"), dialled
    /// through the local Tor SOCKS proxy — for a node whose clearnet ports
    /// are firewalled, this is the only outside view of it.
    lnd_onion: Option<String>,
    /// A page to GET, e.g. https://example.com/ — catches a web server that is
    /// down while the box and its ports are up.
    http_url: Option<String>,
    /// Text the page body must contain.
    http_expect: Option<String>,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct HostProbe {
    host: String,
    /// Set when the host string itself was unusable; nothing else ran.
    error: Option<String>,
    dns: Option<DnsResult>,
    icmp: Option<IcmpResult>,
    tcp: Vec<TcpResult>,
    tls: Option<TlsResult>,
    http: Option<HttpResult>,
    lnd: Option<LndResult>,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct HttpResult {
    url: String,
    /// Got an HTTP response at all (any status).
    responded: bool,
    status: Option<u16>,
    ms: Option<u64>,
    /// Where redirects ended up, when that differs from `url`.
    final_url: Option<String>,
    server: Option<String>,
    content_type: Option<String>,
    /// Body bytes read (capped at HTTP_BODY_CAP).
    bytes: u64,
    expect: Option<String>,
    /// Whether `expect` was found in the body; None when there's no expect.
    found: Option<bool>,
    error: Option<String>,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct DnsResult {
    ok: bool,
    /// The host was an IP address, so no lookup happened.
    literal: bool,
    ms: Option<u64>,
    addrs: Vec<String>,
    error: Option<String>,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct IcmpResult {
    ok: bool,
    sent: u32,
    received: u32,
    loss_pct: Option<f64>,
    avg_ms: Option<f64>,
    min_ms: Option<f64>,
    max_ms: Option<f64>,
    error: Option<String>,
}

#[derive(Serialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
struct TcpResult {
    port: u16,
    /// The address actually dialled.
    addr: Option<String>,
    ok: bool,
    ms: Option<u64>,
    /// open | refused | timeout | error
    state: String,
    error: Option<String>,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct CertInfo {
    subject: String,
    issuer: String,
    sans: Vec<String>,
    /// Unix seconds.
    not_before: i64,
    not_after: i64,
    /// Whole days until not_after; negative once expired.
    days_left: i64,
    sha256: String,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct TlsResult {
    port: u16,
    /// The name the certificate was checked against.
    name: String,
    /// Handshake completed AND the chain verified against the webpki roots
    /// for this name.
    ok: bool,
    ms: Option<u64>,
    /// Why verification failed (expired, wrong name, unknown issuer…). The
    /// certificate is still read, over an unverified handshake, so an expired
    /// one can show how long ago it lapsed.
    verify_error: Option<String>,
    /// The connection itself failed; no certificate was seen.
    error: Option<String>,
    protocol: Option<String>,
    cert: Option<CertInfo>,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct LndResult {
    p2p: Option<TcpResult>,
    /// p2p over Tor to the onion address.
    onion: Option<TcpResult>,
    rest_port: Option<u16>,
    rest_ok: bool,
    rest_ms: Option<u64>,
    /// WalletState from GET /v1/state: NON_EXISTING, LOCKED, UNLOCKED,
    /// RPC_ACTIVE, SERVER_ACTIVE, WAITING_TO_START.
    state: Option<String>,
    rest_error: Option<String>,
    /// LND's self-signed tls.cert. Its fingerprint identifies the node.
    cert: Option<CertInfo>,
}

#[tauri::command]
pub async fn probe_host(spec: HostSpec) -> HostProbe {
    let host = spec.host.clone();
    tauri::async_runtime::spawn_blocking(move || probe(spec))
        .await
        .unwrap_or_else(|e| HostProbe {
            host,
            error: Some(format!("probe task failed: {e}")),
            ..Default::default()
        })
}

fn probe(spec: HostSpec) -> HostProbe {
    let host = spec.host.trim().to_string();
    let mut out = HostProbe {
        host: host.clone(),
        ..Default::default()
    };
    if let Err(e) = validate_host(&host) {
        out.error = Some(e);
        return out;
    }
    let tls_name = spec
        .tls_name
        .as_deref()
        .map(str::trim)
        .filter(|n| !n.is_empty())
        .unwrap_or(&host)
        .to_string();
    if let Err(e) = validate_host(&tls_name) {
        out.error = Some(format!("TLS name: {e}"));
        return out;
    }

    // DNS first: every socket check dials an address it produced. ICMP does
    // its own lookup inside `ping`, so it can run even when this fails.
    let (dns, addrs) = resolve(&host);
    let target = pick_addr(&addrs);
    out.dns = Some(dns);

    let host = host.as_str();
    let tls_name = tls_name.as_str();
    std::thread::scope(|s| {
        let icmp = spec.icmp.then(|| s.spawn(move || ping(host)));
        let tcp: Vec<_> = spec
            .tcp_ports
            .iter()
            .map(|&p| s.spawn(move || tcp_check(target, p)))
            .collect();
        let tls = spec.tls_port.map(|p| s.spawn(move || tls_check(tls_name, target, p)));
        let http = spec.http_url.as_deref().map(str::trim).filter(|u| !u.is_empty()).map(|u| {
            let expect = spec.http_expect.clone().filter(|e| !e.trim().is_empty());
            s.spawn(move || http_check(u, expect))
        });
        let onion = spec.lnd_onion.clone().filter(|o| !o.trim().is_empty());
        let lnd = (spec.lnd_p2p_port.is_some() || spec.lnd_rest_port.is_some() || onion.is_some())
            .then(|| {
                let (p2p, rest) = (spec.lnd_p2p_port, spec.lnd_rest_port);
                s.spawn(move || {
                    let mut r = lnd_check(host, target, p2p, rest);
                    r.onion = onion.map(|o| onion_check(&o));
                    r
                })
            });

        out.icmp = icmp.map(|h| h.join().unwrap_or_else(|_| IcmpResult::failed("check panicked")));
        out.tcp = tcp.into_iter().filter_map(|h| h.join().ok()).collect();
        out.tls = tls.and_then(|h| h.join().ok());
        out.http = http.and_then(|h| h.join().ok());
        out.lnd = lnd.and_then(|h| h.join().ok());
    });
    out
}

/// A hostname or IP literal, and nothing `ping` could read as a flag.
fn validate_host(h: &str) -> Result<(), String> {
    if h.is_empty() {
        return Err("no host".into());
    }
    if h.starts_with('-') {
        return Err("host can't start with '-'".into());
    }
    if !h
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | ':' | '_'))
    {
        return Err("host must be a bare hostname or IP (no scheme, path or port)".into());
    }
    Ok(())
}

fn resolve(host: &str) -> (DnsResult, Vec<SocketAddr>) {
    if let Ok(ip) = host.parse::<IpAddr>() {
        return (
            DnsResult {
                ok: true,
                literal: true,
                addrs: vec![ip.to_string()],
                ..Default::default()
            },
            vec![SocketAddr::new(ip, 0)],
        );
    }
    let t = Instant::now();
    match (host, 0u16).to_socket_addrs() {
        Ok(it) => {
            let mut addrs: Vec<SocketAddr> = it.collect();
            addrs.dedup();
            let ms = Some(t.elapsed().as_millis() as u64);
            if addrs.is_empty() {
                return (
                    DnsResult {
                        ms,
                        error: Some("resolved to no address".into()),
                        ..Default::default()
                    },
                    addrs,
                );
            }
            (
                DnsResult {
                    ok: true,
                    ms,
                    addrs: addrs.iter().map(|a| a.ip().to_string()).collect(),
                    ..Default::default()
                },
                addrs,
            )
        }
        Err(e) => (
            DnsResult {
                ms: Some(t.elapsed().as_millis() as u64),
                error: Some(format!("lookup failed: {e}")),
                ..Default::default()
            },
            vec![],
        ),
    }
}

/// Prefer IPv4: a box with a broken AAAA record is common, and v4 is what the
/// servers' firewalls are written against.
fn pick_addr(addrs: &[SocketAddr]) -> Option<IpAddr> {
    addrs
        .iter()
        .find(|a| a.is_ipv4())
        .or_else(|| addrs.first())
        .map(|a| a.ip())
}

// ── ICMP ────────────────────────────────────────────────────────────────
// Shells out to the system `ping`, which carries the capability to open a raw
// socket. An unprivileged ICMP socket would need net.ipv4.ping_group_range to
// include the user's group, and Ubuntu ships it closed ("1 0").

impl IcmpResult {
    fn failed(e: &str) -> Self {
        IcmpResult {
            error: Some(e.into()),
            ..Default::default()
        }
    }
}

fn ping(host: &str) -> IcmpResult {
    let mut cmd = Command::new("ping");
    if cfg!(target_os = "windows") {
        cmd.args(["-n", "3", "-w", "2000", host]);
    } else if cfg!(target_os = "macos") {
        // -t: overall timeout in seconds on macOS.
        cmd.args(["-n", "-c", "3", "-t", "6", host]);
    } else {
        // -W per-reply wait, -w overall deadline, both seconds.
        cmd.args(["-n", "-c", "3", "-i", "0.3", "-W", "2", "-w", "6", host]);
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let output = match cmd.output() {
        Ok(o) => o,
        Err(e) => return IcmpResult::failed(&format!("couldn't run ping: {e}")),
    };
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let mut r = parse_ping(&stdout);
    r.ok = r.received > 0;
    if !r.ok {
        let msg = stderr.trim();
        r.error = Some(if !msg.is_empty() {
            msg.lines().last().unwrap_or(msg).to_string()
        } else if r.loss_pct.is_some() {
            "no replies (100% loss) — ICMP may be filtered".into()
        } else {
            let tail = stdout.trim().lines().last().unwrap_or("").to_string();
            if tail.is_empty() { "no replies".into() } else { tail }
        });
    }
    r
}

/// Reads the summary lines of iputils, BSD/macOS and Windows ping:
///   "3 packets transmitted, 3 received, 0% packet loss"
///   "rtt min/avg/max/mdev = 1.1/2.2/3.3/0.4 ms"      (Linux)
///   "round-trip min/avg/max/stddev = …"               (macOS)
///   "Lost = 0 (0% loss)" / "Minimum = 1ms, Maximum = 3ms, Average = 2ms"
fn parse_ping(s: &str) -> IcmpResult {
    let mut r = IcmpResult::default();
    for line in s.lines() {
        let l = line.trim();
        if let Some(i) = l.find("% packet loss").or_else(|| l.find("% loss")) {
            let num: String = l[..i]
                .chars()
                .rev()
                .take_while(|c| c.is_ascii_digit() || *c == '.')
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect();
            r.loss_pct = num.parse().ok();
        }
        // With a deadline, iputils keeps sending until it has `-c` replies, so
        // read both counts rather than deriving them from the loss figure.
        if l.contains("transmitted") || l.starts_with("Packets:") {
            r.sent = count_near(l, "transmitted", "Sent").unwrap_or(0);
            r.received = count_near(l, "received", "Received").unwrap_or(0);
        }
        if l.contains("min/avg/max") {
            if let Some((_, vals)) = l.split_once('=') {
                let v: Vec<f64> = vals
                    .trim()
                    .trim_end_matches("ms")
                    .trim()
                    .split('/')
                    .filter_map(|x| x.trim().parse().ok())
                    .collect();
                if v.len() >= 3 {
                    (r.min_ms, r.avg_ms, r.max_ms) = (Some(v[0]), Some(v[1]), Some(v[2]));
                }
            }
        }
        if l.starts_with("Minimum") {
            let ms = |key: &str| {
                l.split(',')
                    .find(|p| p.trim().starts_with(key))
                    .and_then(|p| p.split('=').nth(1))
                    .and_then(|v| v.trim().trim_end_matches("ms").parse().ok())
            };
            (r.min_ms, r.max_ms, r.avg_ms) = (ms("Minimum"), ms("Maximum"), ms("Average"));
        }
    }
    r
}

/// The number just before `before` ("3 packets transmitted", "2 received",
/// macOS's "3 packets received") or just after `after` ("Received = 3").
fn count_near(s: &str, before: &str, after: &str) -> Option<u32> {
    let toks: Vec<&str> = s
        .split(|c: char| c.is_whitespace() || c == ',' || c == '=')
        .filter(|t| !t.is_empty())
        .collect();
    let num = |i: usize| toks.get(i).and_then(|t| t.parse().ok());
    let i = toks.iter().position(|t| *t == before || *t == after)?;
    if toks[i] == after {
        num(i + 1)
    } else {
        num(i.wrapping_sub(1)).or_else(|| num(i.wrapping_sub(2)))
    }
}

// ── TCP ─────────────────────────────────────────────────────────────────

fn tcp_check(target: Option<IpAddr>, port: u16) -> TcpResult {
    let mut r = TcpResult {
        port,
        ..Default::default()
    };
    let Some(ip) = target else {
        r.state = "error".into();
        r.error = Some("no address (DNS failed)".into());
        return r;
    };
    let addr = SocketAddr::new(ip, port);
    r.addr = Some(addr.to_string());
    let t = Instant::now();
    match TcpStream::connect_timeout(&addr, CONNECT_TIMEOUT) {
        Ok(_) => {
            r.ok = true;
            r.ms = Some(t.elapsed().as_millis() as u64);
            r.state = "open".into();
        }
        Err(e) => {
            r.ms = Some(t.elapsed().as_millis() as u64);
            r.state = match e.kind() {
                std::io::ErrorKind::ConnectionRefused => "refused",
                std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock => "timeout",
                _ => "error",
            }
            .into();
            r.error = Some(e.to_string());
        }
    }
    r
}

// ── TLS ─────────────────────────────────────────────────────────────────

fn provider() -> Arc<rustls::crypto::CryptoProvider> {
    Arc::new(rustls::crypto::ring::default_provider())
}

fn verified_config() -> Result<Arc<ClientConfig>, String> {
    let roots = RootCertStore {
        roots: webpki_roots::TLS_SERVER_ROOTS.to_vec(),
    };
    ClientConfig::builder_with_provider(provider())
        .with_safe_default_protocol_versions()
        .map(|b| Arc::new(b.with_root_certificates(roots).with_no_client_auth()))
        .map_err(|e| e.to_string())
}

/// Accepts any certificate. Used only to *read* a certificate that failed
/// verification (or LND's self-signed one) — nothing sensitive is sent over
/// these connections.
#[derive(Debug)]
struct AcceptAny(Arc<rustls::crypto::CryptoProvider>);

impl ServerCertVerifier for AcceptAny {
    fn verify_server_cert(
        &self,
        _: &CertificateDer<'_>,
        _: &[CertificateDer<'_>],
        _: &ServerName<'_>,
        _: &[u8],
        _: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        Ok(ServerCertVerified::assertion())
    }
    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls12_signature(
            message,
            cert,
            dss,
            &self.0.signature_verification_algorithms,
        )
    }
    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls13_signature(
            message,
            cert,
            dss,
            &self.0.signature_verification_algorithms,
        )
    }
    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.0.signature_verification_algorithms.supported_schemes()
    }
}

fn unverified_config() -> Result<Arc<ClientConfig>, String> {
    let p = provider();
    ClientConfig::builder_with_provider(p.clone())
        .with_safe_default_protocol_versions()
        .map(|b| {
            Arc::new(
                b.dangerous()
                    .with_custom_certificate_verifier(Arc::new(AcceptAny(p)))
                    .with_no_client_auth(),
            )
        })
        .map_err(|e| e.to_string())
}

type TlsStream = rustls::StreamOwned<ClientConnection, TcpStream>;

/// TCP connect + full TLS handshake. Err carries a message for the user.
fn tls_connect(
    config: Arc<ClientConfig>,
    sni: &str,
    ip: IpAddr,
    port: u16,
) -> Result<TlsStream, String> {
    let name = ServerName::try_from(sni.to_string()).map_err(|e| format!("bad server name: {e}"))?;
    let sock = TcpStream::connect_timeout(&SocketAddr::new(ip, port), CONNECT_TIMEOUT)
        .map_err(|e| format!("TCP connect failed: {e}"))?;
    let _ = sock.set_read_timeout(Some(IO_TIMEOUT));
    let _ = sock.set_write_timeout(Some(IO_TIMEOUT));
    let conn = ClientConnection::new(config, name).map_err(|e| e.to_string())?;
    let mut tls = rustls::StreamOwned::new(conn, sock);
    while tls.conn.is_handshaking() {
        tls.conn
            .complete_io(&mut tls.sock)
            .map_err(|e| tls_error_text(&e))?;
    }
    Ok(tls)
}

/// rustls wraps its verification errors in an io::Error; unwrap them so the
/// user reads "certificate expired 3 days ago", not a Debug dump.
fn tls_error_text(e: &std::io::Error) -> String {
    match e.get_ref().and_then(|i| i.downcast_ref::<rustls::Error>()) {
        Some(rustls::Error::InvalidCertificate(c)) => cert_error_text(c),
        Some(other) => other.to_string(),
        None => e.to_string(),
    }
}

fn cert_error_text(c: &rustls::CertificateError) -> String {
    use rustls::CertificateError as E;
    let days = |a: UnixTime, b: UnixTime| (a.as_secs() as i64 - b.as_secs() as i64) / 86_400;
    match c {
        E::NotValidForNameContext { expected, presented } => {
            // webpki renders names as `DnsName("x")`; keep just the name.
            let names: Vec<&str> = presented
                .iter()
                .map(|p| p.split('"').nth(1).unwrap_or(p))
                .collect();
            let want = match expected {
                ServerName::DnsName(d) => d.as_ref().to_string(),
                ServerName::IpAddress(ip) => IpAddr::from(*ip).to_string(),
                other => format!("{other:?}"),
            };
            let hint = if matches!(expected, ServerName::IpAddress(_)) {
                " — set a TLS name to check it by domain"
            } else {
                ""
            };
            format!("certificate is for {}, not {want}{hint}", names.join(", "))
        }
        E::NotValidForName => "certificate doesn't cover this name".into(),
        E::ExpiredContext { time, not_after } => {
            format!("certificate expired {} d ago", days(*time, *not_after))
        }
        E::Expired => "certificate expired".into(),
        E::NotValidYetContext { time, not_before } => {
            format!("certificate not valid for another {} d", days(*not_before, *time))
        }
        E::NotValidYet => "certificate not valid yet".into(),
        E::UnknownIssuer => "unknown issuer — self-signed, or the chain is incomplete".into(),
        E::Revoked => "certificate revoked".into(),
        E::BadSignature => "bad certificate signature".into(),
        other => format!("invalid certificate: {other:?}"),
    }
}

fn tls_check(host: &str, target: Option<IpAddr>, port: u16) -> TlsResult {
    let mut r = TlsResult {
        port,
        name: host.to_string(),
        ..Default::default()
    };
    let Some(ip) = target else {
        r.error = Some("no address (DNS failed)".into());
        return r;
    };

    let t = Instant::now();
    let verified = verified_config().and_then(|c| tls_connect(c, host, ip, port));
    r.ms = Some(t.elapsed().as_millis() as u64);
    let stream = match verified {
        Ok(s) => {
            r.ok = true;
            Some(s)
        }
        Err(e) if e.starts_with("TCP connect failed") => {
            r.error = Some(e);
            return r;
        }
        Err(e) => {
            r.verify_error = Some(e);
            match unverified_config().and_then(|c| tls_connect(c, host, ip, port)) {
                Ok(s) => Some(s),
                Err(e2) => {
                    r.error = Some(e2);
                    None
                }
            }
        }
    };
    if let Some(s) = stream {
        r.protocol = s.conn.protocol_version().map(|v| format!("{v:?}").replace('_', "."));
        r.cert = leaf_info(&s.conn);
    }
    r
}

fn leaf_info(conn: &ClientConnection) -> Option<CertInfo> {
    let der = conn.peer_certificates()?.first()?;
    cert_info(der.as_ref())
}

fn cert_info(der: &[u8]) -> Option<CertInfo> {
    use x509_parser::prelude::*;
    let (_, cert) = X509Certificate::from_der(der).ok()?;
    let v = cert.validity();
    let not_after = v.not_after.timestamp();
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let sans = cert
        .subject_alternative_name()
        .ok()
        .flatten()
        .map(|ext| {
            ext.value
                .general_names
                .iter()
                .map(|n| match n {
                    GeneralName::DNSName(d) => d.to_string(),
                    GeneralName::IPAddress(b) => match b.len() {
                        4 => IpAddr::from(<[u8; 4]>::try_from(*b).unwrap()).to_string(),
                        16 => IpAddr::from(<[u8; 16]>::try_from(*b).unwrap()).to_string(),
                        _ => format!("{b:?}"),
                    },
                    other => other.to_string(),
                })
                .collect()
        })
        .unwrap_or_default();
    Some(CertInfo {
        subject: cert.subject().to_string(),
        issuer: cert.issuer().to_string(),
        sans,
        not_before: v.not_before.timestamp(),
        not_after,
        days_left: (not_after - now).div_euclid(86_400),
        sha256: Sha256::digest(der)
            .iter()
            .map(|b| format!("{b:02X}"))
            .collect::<Vec<_>>()
            .join(":"),
    })
}

// ── HTTP ────────────────────────────────────────────────────────────────
// Follows redirects (up to 5), reports the status the chain ended on, and —
// when asked — whether the body contains a given string. Any status counts
// as the server responding; judging 4xx/5xx is the frontend's call.

const HTTP_BODY_CAP: u64 = 2 * 1024 * 1024;

fn http_check(url: &str, expect: Option<String>) -> HttpResult {
    let mut r = HttpResult {
        url: url.to_string(),
        expect: expect.clone(),
        ..Default::default()
    };
    match url::Url::parse(url) {
        Ok(u) if matches!(u.scheme(), "http" | "https") => {}
        Ok(u) => {
            r.error = Some(format!("scheme must be http:// or https://, got '{}'", u.scheme()));
            return r;
        }
        Err(e) => {
            r.error = Some(format!("invalid URL: {e}"));
            return r;
        }
    }
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(CONNECT_TIMEOUT)
        .timeout_read(IO_TIMEOUT)
        .timeout_write(IO_TIMEOUT)
        .redirects(5)
        .user_agent(concat!("nping/", env!("CARGO_PKG_VERSION")))
        .build();
    let t = Instant::now();
    let resp = match agent.get(url).call() {
        Ok(resp) => resp,
        // A 4xx/5xx is still a response — keep its details.
        Err(ureq::Error::Status(_, resp)) => resp,
        Err(ureq::Error::Transport(e)) => {
            r.ms = Some(t.elapsed().as_millis() as u64);
            r.error = Some(e.to_string());
            return r;
        }
    };
    r.responded = true;
    r.status = Some(resp.status());
    if resp.get_url().trim_end_matches('/') != url.trim_end_matches('/') {
        r.final_url = Some(resp.get_url().to_string());
    }
    r.server = resp.header("server").map(String::from);
    r.content_type = resp.header("content-type").map(String::from);
    let mut body = Vec::new();
    let read = resp.into_reader().take(HTTP_BODY_CAP).read_to_end(&mut body);
    r.ms = Some(t.elapsed().as_millis() as u64);
    r.bytes = body.len() as u64;
    if let Err(e) = read {
        r.error = Some(format!("body read failed: {e}"));
    }
    if let Some(want) = expect {
        r.found = Some(String::from_utf8_lossy(&body).contains(want.trim()));
    }
    r
}

// ── LND ─────────────────────────────────────────────────────────────────
// p2p: a TCP connect to the Lightning port (a Noise handshake would need the
// node's pubkey and a key of our own, so reachability is where this stops).
// REST: GET /v1/state, the one endpoint LND serves without a macaroon. LND's
// REST listener only binds localhost unless `restlisten` says otherwise.

fn lnd_check(host: &str, target: Option<IpAddr>, p2p: Option<u16>, rest: Option<u16>) -> LndResult {
    let mut r = LndResult {
        p2p: p2p.map(|p| tcp_check(target, p)),
        rest_port: rest,
        ..Default::default()
    };
    let Some(port) = rest else { return r };
    let Some(ip) = target else {
        r.rest_error = Some("no address (DNS failed)".into());
        return r;
    };

    let t = Instant::now();
    // LND's cert is self-signed, so this is always the unverified handshake;
    // the fingerprint in the result is how to tell it's the right node. An IP
    // host still needs *a* server name for SNI.
    let sni = if host.parse::<IpAddr>().is_ok() { "localhost" } else { host };
    let mut s = match unverified_config().and_then(|c| tls_connect(c, sni, ip, port)) {
        Ok(s) => s,
        Err(e) => {
            r.rest_error = Some(e);
            return r;
        }
    };
    r.cert = leaf_info(&s.conn);

    let req = format!(
        "GET /v1/state HTTP/1.1\r\nHost: {host}:{port}\r\nAccept: application/json\r\nConnection: close\r\n\r\n"
    );
    if let Err(e) = s.write_all(req.as_bytes()) {
        r.rest_error = Some(format!("write failed: {e}"));
        return r;
    }
    let mut buf = Vec::new();
    // LND may close without a TLS close_notify; whatever arrived is enough.
    let read_err = s.read_to_end(&mut buf).err();
    r.rest_ms = Some(t.elapsed().as_millis() as u64);
    let text = String::from_utf8_lossy(&buf);

    let status_line = text.lines().next().unwrap_or("");
    let code: Option<u16> = status_line.split_whitespace().nth(1).and_then(|c| c.parse().ok());
    let body = text.split_once("\r\n\r\n").map(|(_, b)| b).unwrap_or("");
    // The body may be chunked; the JSON object sits inside one chunk.
    let json = match (body.find('{'), body.rfind('}')) {
        (Some(a), Some(b)) if b > a => serde_json::from_str::<serde_json::Value>(&body[a..=b]).ok(),
        _ => None,
    };
    match (code, json) {
        (Some(200), Some(j)) => {
            r.state = j.get("state").and_then(|v| v.as_str()).map(String::from);
            r.rest_ok = r.state.is_some();
            if !r.rest_ok {
                r.rest_error = Some("200 but no \"state\" in the response".into());
            }
        }
        (Some(c), j) => {
            let msg = j
                .as_ref()
                .and_then(|j| j.get("message"))
                .and_then(|m| m.as_str())
                .map(|m| format!(": {m}"))
                .unwrap_or_default();
            r.rest_error = Some(format!("HTTP {c}{msg}"));
        }
        (None, _) => {
            r.rest_error = Some(match read_err {
                Some(e) if buf.is_empty() => format!("read failed: {e}"),
                _ => "no HTTP response".into(),
            });
        }
    }
    r
}

// ── Tor ─────────────────────────────────────────────────────────────────
// A bare SOCKS5 CONNECT through the local Tor client (RFC 1928, no auth):
// enough to learn whether an onion service accepts connections. The proxy
// resolves the name, so the .onion never touches DNS.

const TOR_PROXY: &str = "127.0.0.1:9050";
/// Building a circuit to an onion service routinely takes several seconds.
const TOR_TIMEOUT: Duration = Duration::from_secs(45);
const LND_P2P_DEFAULT: u16 = 9735;

/// "pubkey@abc.onion:9735", "abc.onion:9735" or "abc.onion" → (host, port).
fn parse_onion(s: &str) -> Result<(String, u16), String> {
    let s = s.trim();
    let s = s.rsplit_once('@').map(|(_, a)| a).unwrap_or(s);
    let (host, port) = match s.rsplit_once(':') {
        Some((h, p)) => (h, p.parse::<u16>().map_err(|_| format!("bad port '{p}'"))?),
        None => (s, LND_P2P_DEFAULT),
    };
    if !host.ends_with(".onion") || validate_host(host).is_err() {
        return Err(format!("not an onion address: '{host}'"));
    }
    Ok((host.to_ascii_lowercase(), port))
}

fn onion_check(addr: &str) -> TcpResult {
    let mut r = TcpResult {
        state: "error".into(),
        ..Default::default()
    };
    let (host, port) = match parse_onion(addr) {
        Ok(hp) => hp,
        Err(e) => {
            r.error = Some(e);
            return r;
        }
    };
    r.port = port;
    r.addr = Some(format!("{host}:{port}"));
    let t = Instant::now();
    let res = socks5_connect(&host, port);
    r.ms = Some(t.elapsed().as_millis() as u64);
    match res {
        Ok(()) => {
            r.ok = true;
            r.state = "open".into();
        }
        Err((state, e)) => {
            r.state = state.into();
            r.error = Some(e);
        }
    }
    r
}

/// Err carries (state, message) in the TcpResult vocabulary.
fn socks5_connect(host: &str, port: u16) -> Result<(), (&'static str, String)> {
    let proxy: SocketAddr = TOR_PROXY.parse().expect("static proxy address");
    let mut s = TcpStream::connect_timeout(&proxy, CONNECT_TIMEOUT).map_err(|e| {
        ("error", format!("no Tor proxy at {TOR_PROXY} ({e}) — is tor running?"))
    })?;
    let _ = s.set_read_timeout(Some(TOR_TIMEOUT));
    let _ = s.set_write_timeout(Some(IO_TIMEOUT));
    let io = |e: std::io::Error| {
        let timed_out = matches!(e.kind(), std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock);
        if timed_out {
            ("timeout", "Tor timed out building the circuit".to_string())
        } else {
            ("error", format!("Tor proxy: {e}"))
        }
    };

    s.write_all(&[5, 1, 0]).map_err(io)?; // v5, one method: no auth
    let mut hello = [0u8; 2];
    s.read_exact(&mut hello).map_err(io)?;
    if hello != [5, 0] {
        return Err(("error", format!("proxy refused no-auth SOCKS5 ({hello:?})")));
    }

    let mut req = vec![5, 1, 0, 3, host.len() as u8]; // CONNECT, domain name
    req.extend_from_slice(host.as_bytes());
    req.extend_from_slice(&port.to_be_bytes());
    s.write_all(&req).map_err(io)?;
    let mut head = [0u8; 4];
    s.read_exact(&mut head).map_err(io)?;
    match head[1] {
        0 => Ok(()),
        code => {
            let (state, why) = match code {
                1 => ("error", "general failure (onion service unreachable?)"),
                2 => ("error", "not allowed by the proxy"),
                3 => ("error", "network unreachable"),
                4 => ("timeout", "host unreachable — onion service not found or offline"),
                5 => ("refused", "connection refused by the node"),
                6 => ("timeout", "TTL expired — the circuit timed out"),
                7 => ("error", "command not supported"),
                8 => ("error", "address type not supported"),
                _ => ("error", "unknown SOCKS reply"),
            };
            Err((state, format!("Tor: {why} (SOCKS {code})")))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_linux_ping() {
        let r = parse_ping(
            "4 packets transmitted, 3 received, 25% packet loss, time 602ms\n\
             rtt min/avg/max/mdev = 10.1/12.5/15.0/2.0 ms\n",
        );
        assert_eq!(r.loss_pct, Some(25.0));
        assert_eq!((r.sent, r.received), (4, 3));
        assert_eq!(r.avg_ms, Some(12.5));
    }

    #[test]
    fn parses_macos_ping() {
        let r = parse_ping(
            "3 packets transmitted, 3 packets received, 0.0% packet loss\n\
             round-trip min/avg/max/stddev = 1.0/2.0/3.0/0.8 ms\n",
        );
        assert_eq!((r.sent, r.received), (3, 3));
        assert_eq!(r.max_ms, Some(3.0));
    }

    #[test]
    fn parses_windows_ping() {
        let r = parse_ping(
            "    Packets: Sent = 3, Received = 3, Lost = 0 (0% loss),\n\
             Approximate round trip times in milli-seconds:\n\
                 Minimum = 9ms, Maximum = 12ms, Average = 10ms\n",
        );
        assert_eq!((r.sent, r.received), (3, 3));
        assert_eq!(r.avg_ms, Some(10.0));
    }

    #[test]
    fn parses_onion_uris() {
        let o = "exampleexampleexampleexampleexampleexampleexampleexampl.onion";
        assert_eq!(parse_onion(&format!("02cb@{o}:9735")).unwrap(), (o.into(), 9735));
        assert_eq!(parse_onion(o).unwrap().1, 9735);
        assert_eq!(parse_onion(&format!("{o}:9736")).unwrap().1, 9736);
        assert!(parse_onion("192.0.2.1:9735").is_err());
    }

    #[test]
    fn rejects_flag_like_hosts() {
        assert!(validate_host("-c1").is_err());
        assert!(validate_host("https://x").is_err());
        assert!(validate_host("example.com").is_ok());
        assert!(validate_host("2001:db8::1").is_ok());
    }

    /// Live run against a real machine, printing the JSON the UI would get:
    ///   NPING_HOST=example.com cargo test --lib live_probe -- --ignored --nocapture
    /// Optional NPING_PORTS=22,80,443  NPING_LND=9735,8080 (p2p,rest)
    #[test]
    #[ignore]
    fn live_probe() {
        let host = std::env::var("NPING_HOST").expect("set NPING_HOST");
        let ports = |k: &str| -> Vec<u16> {
            std::env::var(k)
                .unwrap_or_default()
                .split(',')
                .filter_map(|p| p.trim().parse().ok())
                .collect()
        };
        let lnd = ports("NPING_LND");
        let spec = HostSpec {
            host,
            icmp: true,
            tcp_ports: ports("NPING_PORTS"),
            tls_port: Some(443),
            tls_name: std::env::var("NPING_TLS_NAME").ok(),
            lnd_p2p_port: lnd.first().copied(),
            lnd_rest_port: lnd.get(1).copied(),
            lnd_onion: std::env::var("NPING_ONION").ok(),
            http_url: std::env::var("NPING_HTTP").ok(),
            http_expect: std::env::var("NPING_HTTP_EXPECT").ok(),
        };
        println!("{}", serde_json::to_string_pretty(&probe(spec)).unwrap());
    }
}
