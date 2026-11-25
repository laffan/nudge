//! A minimal Server-Sent Events reader over a reqwest byte stream: it
//! yields each event's name (if any) and its joined `data:` lines. Both
//! Anthropic and OpenAI stream this way.

use futures_util::StreamExt;
use std::sync::atomic::{AtomicBool, Ordering};

pub struct SseEvent {
    pub event: String,
    pub data: String,
}

/// Read `resp` to its end, calling `on_event` for every event. Stops early
/// (returning Ok(false)) when `stop` is set; Ok(true) when the stream ran out.
pub async fn read<F>(resp: reqwest::Response, stop: &AtomicBool, mut on_event: F) -> crate::Result<bool>
where
    F: FnMut(SseEvent) -> crate::Result<()>,
{
    let mut stream = resp.bytes_stream();
    let mut buf: Vec<u8> = Vec::new();
    while let Some(chunk) = stream.next().await {
        if stop.load(Ordering::SeqCst) {
            return Ok(false);
        }
        buf.extend_from_slice(&chunk?);
        // Events end at a blank line; providers send \n\n (allow \r\n\r\n).
        loop {
            let Some((end, skip)) = find_boundary(&buf) else { break };
            let raw = String::from_utf8_lossy(&buf[..end]).to_string();
            buf.drain(..end + skip);
            if let Some(ev) = parse(&raw) {
                on_event(ev)?;
            }
        }
    }
    if !buf.is_empty() {
        let raw = String::from_utf8_lossy(&buf).to_string();
        if let Some(ev) = parse(&raw) {
            on_event(ev)?;
        }
    }
    Ok(true)
}

fn find_boundary(buf: &[u8]) -> Option<(usize, usize)> {
    for i in 0..buf.len().saturating_sub(1) {
        if buf[i] == b'\n' && buf[i + 1] == b'\n' {
            return Some((i, 2));
        }
        if i + 3 < buf.len() && &buf[i..i + 4] == b"\r\n\r\n" {
            return Some((i, 4));
        }
    }
    None
}

fn parse(raw: &str) -> Option<SseEvent> {
    let mut event = String::new();
    let mut data: Vec<&str> = Vec::new();
    for line in raw.lines() {
        if let Some(v) = line.strip_prefix("event:") {
            event = v.trim().to_string();
        } else if let Some(v) = line.strip_prefix("data:") {
            data.push(v.strip_prefix(' ').unwrap_or(v));
        }
    }
    if data.is_empty() && event.is_empty() {
        return None;
    }
    Some(SseEvent { event, data: data.join("\n") })
}
