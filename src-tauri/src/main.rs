// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if app_lib::cli::is_cli_invocation(&args) {
        std::process::exit(app_lib::cli::run(args));
    }
    app_lib::run()
}
