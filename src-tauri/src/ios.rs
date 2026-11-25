//! iPad-only window setup: no status bar, so the columns reach the top of
//! the window.
//!
//! The window's root view controller is tao's `TaoUIViewController`, which
//! keeps a `prefersStatusBarHidden` preference and tells UIKit when it
//! changes (`setPrefersStatusBarHidden:`, as tao's own
//! `WindowExtIOS::set_prefers_status_bar_hidden`). Tauri hands it out as the
//! webview's `view_controller()`. As in Snorkle, it is asked at launch and
//! again whenever the app becomes active, in case the window was not set up
//! yet the first time (with the scene manifest in Info.ios.plist the window
//! arrives when its scene connects).

use objc2::runtime::{AnyObject, Bool};
use objc2::{msg_send, sel};
use tauri::{AppHandle, Manager, RunEvent, Runtime};

/// Once the window is up, and whenever the app comes back to the
/// foreground, the status bar is asked to stay hidden.
pub fn on_run_event<R: Runtime>(app: &AppHandle<R>, event: &RunEvent) {
    if matches!(event, RunEvent::Ready | RunEvent::Resumed) {
        hide_status_bar(app);
    }
}

pub fn hide_status_bar<R: Runtime>(app: &AppHandle<R>) {
    for (_, window) in app.webview_windows() {
        let _ = window.with_webview(|webview| {
            let vc = webview.view_controller() as *mut AnyObject;
            // SAFETY: the pointer is the window's live UIViewController, and
            // with_webview runs this on the main thread. The selector is
            // checked before it is sent.
            unsafe {
                let Some(vc) = vc.as_ref() else { return };
                let responds: bool = msg_send![vc, respondsToSelector: sel!(setPrefersStatusBarHidden:)];
                if responds {
                    let _: () = msg_send![vc, setPrefersStatusBarHidden: Bool::YES];
                }
            }
        });
    }
}
