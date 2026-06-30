// Tauri commands for nping — a Nostr relay connectivity tester for the
// ndisc suite. A single command, `probe_relay`, runs three independent
// checks against one relay and returns a structured report the frontend
// renders with per-stage indicators:
//
//   1. connect   — open the WebSocket (TCP + TLS + HTTP upgrade), timed.
//   2. subscribe — send a tiny REQ and wait for EOSE, timed; counts the
//                  events that arrived first, surfaces NOTICE/CLOSED.
//   3. info      — fetch the NIP-11 relay-information document over HTTP.
//                  Done here in Rust (not the webview) so the browser CORS
//                  wall most relays trip doesn't hide the answer.
//
// Everything is blocking I/O bounded by explicit timeouts and run on a
// blocking thread (spawn_blocking) so many relays probe concurrently from
// the frontend without stalling the UI thread.

use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::time::{Duration, Instant};

use serde::Serialize;
use tungstenite::client::client as ws_handshake;
use tungstenite::client::IntoClientRequest;
use tungstenite::{client_tls, Message, WebSocket};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(8);
const IO_TIMEOUT: Duration = Duration::from_secs(8);
const REQ_TIMEOUT: Duration = Duration::from_secs(8);
const NIP11_TIMEOUT: Duration = Duration::from_secs(8);

// Subscription id used for the round-trip REQ. Fixed string is fine — only
// one subscription is ever open per probe connection.
const SUB_ID: &str = "nping";

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct RelayProbe {
    url: String,
    /// Overall health: connected AND the subscription reached EOSE.
    ok: bool,
    // --- connect stage ---
    connect_ok: bool,
    connect_ms: Option<u64>,
    connect_error: Option<String>,
    // --- subscribe (REQ → EOSE) stage ---
    req_ok: bool,
    req_ms: Option<u64>,
    req_events: u32,
    req_eose: bool,
    req_error: Option<String>,
    /// A NOTICE message the relay sent during the subscription, if any.
    notice: Option<String>,
    // --- NIP-11 relay information document ---
    info: Option<Nip11>,
    info_error: Option<String>,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct Nip11 {
    name: Option<String>,
    description: Option<String>,
    software: Option<String>,
    version: Option<String>,
    pubkey: Option<String>,
    contact: Option<String>,
    supported_nips: Vec<i64>,
    payment_required: bool,
    auth_required: bool,
}

/// Outcome of opening the socket and running the REQ over it.
struct ConnOut {
    connect_ms: Option<u64>,
    connect_error: Option<String>,
    req: Option<ReqOutcome>,
}

struct ReqOutcome {
    ms: u64,
    events: u32,
    eose: bool,
    error: Option<String>,
    notice: Option<String>,
}

#[tauri::command]
async fn probe_relay(url: String) -> RelayProbe {
    tauri::async_runtime::spawn_blocking(move || probe(&url))
        .await
        .unwrap_or_else(|e| RelayProbe {
            ok: false,
            connect_error: Some(format!("probe task failed: {e}")),
            ..Default::default()
        })
}

fn probe(url_str: &str) -> RelayProbe {
    let url_str = url_str.trim();
    let mut out = RelayProbe {
        url: url_str.to_string(),
        ..Default::default()
    };

    let parsed = match url::Url::parse(url_str) {
        Ok(u) => u,
        Err(e) => {
            out.connect_error = Some(format!("invalid URL: {e}"));
            return out;
        }
    };
    let secure = match parsed.scheme() {
        "wss" => true,
        "ws" => false,
        other => {
            out.connect_error = Some(format!("scheme must be ws:// or wss://, got '{other}'"));
            return out;
        }
    };
    let host = match parsed.host_str() {
        Some(h) => h.to_string(),
        None => {
            out.connect_error = Some("URL has no host".into());
            return out;
        }
    };
    let port = parsed
        .port_or_known_default()
        .unwrap_or(if secure { 443 } else { 80 });

    // Resolve once, up front — a clear DNS failure is a common connectivity
    // problem worth surfacing on its own.
    let addr = match (host.as_str(), port).to_socket_addrs() {
        Ok(mut it) => match it.next() {
            Some(a) => a,
            None => {
                out.connect_error = Some("DNS resolved to no address".into());
                return out;
            }
        },
        Err(e) => {
            out.connect_error = Some(format!("DNS lookup failed: {e}"));
            return out;
        }
    };

    let c = do_connect(url_str, secure, addr);
    out.connect_ms = c.connect_ms;
    out.connect_error = c.connect_error;
    out.connect_ok = out.connect_ms.is_some() && out.connect_error.is_none();
    if let Some(r) = c.req {
        out.req_ms = Some(r.ms);
        out.req_events = r.events;
        out.req_eose = r.eose;
        out.req_error = r.error;
        out.req_ok = r.eose;
        out.notice = r.notice;
    }

    // NIP-11 is independent of the WebSocket — fetch it even if the socket
    // failed, since "WS down but HTTP up" (or vice-versa) is itself a useful
    // diagnostic.
    let (info, info_err) = fetch_nip11(&host, port, secure, parsed.path());
    out.info = info;
    out.info_error = info_err;

    out.ok = out.connect_ok && out.req_ok;
    out
}

fn do_connect(url_str: &str, secure: bool, addr: std::net::SocketAddr) -> ConnOut {
    let none = |e: String| ConnOut {
        connect_ms: None,
        connect_error: Some(e),
        req: None,
    };

    let t0 = Instant::now();
    let stream = match TcpStream::connect_timeout(&addr, CONNECT_TIMEOUT) {
        Ok(s) => s,
        Err(e) => return none(format!("TCP connect failed: {e}")),
    };
    let _ = stream.set_read_timeout(Some(IO_TIMEOUT));
    let _ = stream.set_write_timeout(Some(IO_TIMEOUT));

    let request = match url_str.into_client_request() {
        Ok(r) => r,
        Err(e) => return none(format!("bad request: {e}")),
    };

    // The two TLS/plain branches yield different concrete stream types, so the
    // shared REQ loop is generic (run_req) and called inside each arm.
    if secure {
        match client_tls(request, stream) {
            Ok((mut ws, _resp)) => {
                let connect_ms = t0.elapsed().as_millis() as u64;
                let req = run_req(&mut ws);
                let _ = ws.close(None);
                ConnOut {
                    connect_ms: Some(connect_ms),
                    connect_error: None,
                    req: Some(req),
                }
            }
            Err(e) => none(format!("WSS handshake failed: {e}")),
        }
    } else {
        match ws_handshake(request, stream) {
            Ok((mut ws, _resp)) => {
                let connect_ms = t0.elapsed().as_millis() as u64;
                let req = run_req(&mut ws);
                let _ = ws.close(None);
                ConnOut {
                    connect_ms: Some(connect_ms),
                    connect_error: None,
                    req: Some(req),
                }
            }
            Err(e) => none(format!("WS handshake failed: {e}")),
        }
    }
}

fn run_req<S: Read + Write>(ws: &mut WebSocket<S>) -> ReqOutcome {
    let t = Instant::now();
    let req = format!(r#"["REQ","{SUB_ID}",{{"kinds":[1],"limit":1}}]"#);
    if let Err(e) = ws.send(Message::Text(req)) {
        return ReqOutcome {
            ms: t.elapsed().as_millis() as u64,
            events: 0,
            eose: false,
            error: Some(format!("failed to send REQ: {e}")),
            notice: None,
        };
    }

    let mut events = 0u32;
    let mut eose = false;
    let mut notice = None;
    let mut error = None;
    let deadline = Instant::now() + REQ_TIMEOUT;

    loop {
        if Instant::now() >= deadline {
            error = Some("timed out waiting for EOSE".into());
            break;
        }
        match ws.read() {
            Ok(Message::Text(txt)) => {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&txt) {
                    match v.get(0).and_then(|x| x.as_str()) {
                        Some("EVENT") => events += 1,
                        Some("EOSE") => {
                            eose = true;
                            break;
                        }
                        Some("NOTICE") => {
                            notice = v.get(1).and_then(|x| x.as_str()).map(String::from);
                        }
                        Some("CLOSED") => {
                            error = v
                                .get(2)
                                .and_then(|x| x.as_str())
                                .map(String::from)
                                .or_else(|| Some("subscription closed by relay".into()));
                            break;
                        }
                        _ => {}
                    }
                }
            }
            Ok(Message::Ping(p)) => {
                let _ = ws.send(Message::Pong(p));
            }
            Ok(Message::Close(_)) => {
                error = Some("relay closed the connection".into());
                break;
            }
            Ok(_) => {}
            Err(e) => {
                // A read timeout surfaces here as a WouldBlock/timed-out IO
                // error; report whatever the transport said.
                error = Some(format!("read error: {e}"));
                break;
            }
        }
    }

    let _ = ws.send(Message::Text(format!(r#"["CLOSE","{SUB_ID}"]"#)));

    ReqOutcome {
        ms: t.elapsed().as_millis() as u64,
        events,
        eose,
        error,
        notice,
    }
}

fn fetch_nip11(
    host: &str,
    port: u16,
    secure: bool,
    path: &str,
) -> (Option<Nip11>, Option<String>) {
    let scheme = if secure { "https" } else { "http" };
    // Keep an explicit port only when it's non-default, to match what relays
    // expect on their info endpoint.
    let default_port = if secure { 443 } else { 80 };
    let authority = if port == default_port {
        host.to_string()
    } else {
        format!("{host}:{port}")
    };
    let info_url = format!("{scheme}://{authority}{path}");

    let agent = ureq::AgentBuilder::new()
        .timeout_connect(NIP11_TIMEOUT)
        .timeout_read(NIP11_TIMEOUT)
        .timeout_write(NIP11_TIMEOUT)
        .build();

    match agent
        .get(&info_url)
        .set("Accept", "application/nostr+json")
        .call()
    {
        Ok(resp) => match resp.into_string() {
            Ok(body) => match serde_json::from_str::<serde_json::Value>(&body) {
                Ok(j) => (Some(parse_nip11(&j)), None),
                Err(e) => (None, Some(format!("malformed NIP-11 JSON: {e}"))),
            },
            Err(e) => (None, Some(format!("failed to read body: {e}"))),
        },
        Err(ureq::Error::Status(code, _)) => (None, Some(format!("HTTP {code}"))),
        Err(e) => (None, Some(format!("request failed: {e}"))),
    }
}

fn parse_nip11(j: &serde_json::Value) -> Nip11 {
    let s = |k: &str| {
        j.get(k)
            .and_then(|v| v.as_str())
            .filter(|x| !x.is_empty())
            .map(String::from)
    };
    let supported_nips = j
        .get("supported_nips")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|x| x.as_i64()).collect())
        .unwrap_or_default();
    let lim = j.get("limitation");
    let lim_bool = |k: &str| {
        lim.and_then(|l| l.get(k))
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
    };
    Nip11 {
        name: s("name"),
        description: s("description"),
        software: s("software"),
        version: s("version"),
        pubkey: s("pubkey"),
        contact: s("contact"),
        supported_nips,
        payment_required: lim_bool("payment_required"),
        auth_required: lim_bool("auth_required"),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![probe_relay])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
