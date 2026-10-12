fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    std::process::exit(app_lib::mcp::run_stdio(&args));
}
