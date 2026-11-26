use std::process::Command;

fn main() {
    link_clang_runtime_on_macos();
    tauri_build::build()
}

/// llama.cpp's Metal backend checks `@available(macOS 15.0, …)`, and with a
/// deployment target below 15 (bundle.macOS.minimumSystemVersion is 13.0) clang
/// turns that into a call to `__isPlatformVersionAtLeast`. The function lives in
/// clang's runtime library, libclang_rt.osx.a, which rustc leaves off the link
/// line (it links with -nodefaultlibs), so the Apple silicon release build fails
/// with "Undefined symbols … ___isPlatformVersionAtLeast". Linking the library
/// here supplies it. The archive is universal, so one path serves both arches.
fn link_clang_runtime_on_macos() {
    println!("cargo:rerun-if-changed=build.rs");
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    if target_os != "macos" || std::env::var_os("CARGO_FEATURE_LOCAL_LLM").is_none() {
        return;
    }
    let resource_dir = Command::new("xcrun")
        .args(["clang", "--print-resource-dir"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string());
    match resource_dir {
        Some(dir) if !dir.is_empty() => {
            println!("cargo:rustc-link-search=native={dir}/lib/darwin");
            println!("cargo:rustc-link-lib=static=clang_rt.osx");
        }
        _ => println!(
            "cargo:warning=could not find clang's resource directory; \
             the link may fail with an undefined ___isPlatformVersionAtLeast"
        ),
    }
}
