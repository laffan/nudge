//! iPad-only window setup.
//!
//! **No status bar**, so the columns reach the top of the window. The
//! window's root view controller is tao's `TaoUIViewController`, which keeps
//! a `prefersStatusBarHidden` preference and tells UIKit when it changes
//! (`setPrefersStatusBarHidden:`, as tao's own
//! `WindowExtIOS::set_prefers_status_bar_hidden`). Tauri hands it out as the
//! webview's `view_controller()`. As in Snorkle, it is asked at launch and
//! again whenever the app becomes active, in case the window was not set up
//! yet the first time (with the scene manifest in Info.ios.plist the window
//! arrives when its scene connects).
//!
//! **The hardware keyboard goes to the page.** Ported from Hush's
//! `KeyboardFocus.swift`. On iPad a key goes only to the first responder,
//! and for the page that's WebKit's content view inside the WKWebView.
//! Nothing gives it that role at launch (wry does on macOS, not on iOS), and
//! a trackpad click never does: WebKit promotes the content view only for a
//! finger tap or for text being focused while the user interacts. So with a
//! Magic Keyboard ⌘\, ⌘N and the rest did nothing until a tap landed in
//! editable text. The web view is made first responder at launch (tried a
//! few times while the window appears), on resume, and when the page asks
//! after a trackpad click outside editable text (`claim_keyboard`). That
//! happens only while a hardware keyboard is attached; otherwise a claim
//! with the editor focused would slide the on-screen keyboard up. It is
//! never done over a presented view controller (a share sheet, the Files
//! picker), and never taken from a view inside the web view that already
//! holds it.

use objc2::runtime::{AnyClass, AnyObject, Bool};
use objc2::{msg_send, sel};
use std::ffi::{c_char, c_int, c_void};
use std::sync::OnceLock;
use std::time::Duration;
use tauri::{AppHandle, Manager, RunEvent, Runtime};

/// Once the window is up, and whenever the app comes back to the
/// foreground: no status bar, and the keyboard to the page.
pub fn on_run_event<R: Runtime>(app: &AppHandle<R>, event: &RunEvent) {
    match event {
        RunEvent::Ready => {
            hide_status_bar(app);
            // The window may not hold the web view yet; claiming again is a
            // no-op once it worked.
            let app = app.clone();
            std::thread::spawn(move || {
                for _ in 0..10 {
                    claim_keyboard(&app);
                    std::thread::sleep(Duration::from_millis(500));
                }
            });
        }
        RunEvent::Resumed => {
            hide_status_bar(app);
            claim_keyboard(app);
        }
        _ => {}
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

/// Make each window's web view first responder, if a hardware keyboard is
/// attached and nothing else should have the keys.
pub fn claim_keyboard<R: Runtime>(app: &AppHandle<R>) {
    for (_, window) in app.webview_windows() {
        let _ = window.with_webview(|webview| {
            let web = webview.inner() as *mut AnyObject;
            // SAFETY: the WKWebView is alive while its window is, and this
            // runs on the main thread (with_webview).
            unsafe {
                if let Some(web) = web.as_ref() {
                    claim(web);
                }
            }
        });
    }
}

unsafe fn claim(web: &AnyObject) {
    if !hardware_keyboard() {
        return;
    }
    let window: *mut AnyObject = msg_send![web, window];
    let Some(window) = window.as_ref() else { return };
    let root: *mut AnyObject = msg_send![window, rootViewController];
    if let Some(root) = root.as_ref() {
        let presented: *mut AnyObject = msg_send![root, presentedViewController];
        if !presented.is_null() {
            return;
        }
    }
    if holds_first_responder(web) {
        return;
    }
    let _: bool = msg_send![web, becomeFirstResponder];
}

/// WKWebView never reports first responder itself (its content view takes
/// the role), so look anywhere under it.
unsafe fn holds_first_responder(view: &AnyObject) -> bool {
    let is: bool = msg_send![view, isFirstResponder];
    if is {
        return true;
    }
    let subviews: *mut AnyObject = msg_send![view, subviews];
    let Some(subviews) = subviews.as_ref() else { return false };
    let n: usize = msg_send![subviews, count];
    (0..n).any(|i| {
        let v: *mut AnyObject = msg_send![subviews, objectAtIndex: i];
        v.as_ref().is_some_and(|v| holds_first_responder(v))
    })
}

extern "C" {
    fn dlopen(path: *const c_char, mode: c_int) -> *mut c_void;
}

/// Is a hardware keyboard attached (GameController's `GCKeyboard`)? The
/// framework is loaded on first use, as the generated Xcode project doesn't
/// link it; if it can't be, the answer is no, and nothing is claimed.
fn hardware_keyboard() -> bool {
    static LOADED: OnceLock<()> = OnceLock::new();
    LOADED.get_or_init(|| unsafe {
        const RTLD_LAZY: c_int = 1;
        dlopen(c"/System/Library/Frameworks/GameController.framework/GameController".as_ptr(), RTLD_LAZY);
    });
    let Some(class) = AnyClass::get(c"GCKeyboard") else { return false };
    // SAFETY: a class method of a class that exists, returning an object or nil.
    let keyboard: *mut AnyObject = unsafe { msg_send![class, coalescedKeyboard] };
    !keyboard.is_null()
}
