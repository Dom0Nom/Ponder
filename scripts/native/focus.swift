import Cocoa
// Activates the app whose name matches argv[1].
let name = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "ponder"
for app in NSWorkspace.shared.runningApplications where (app.localizedName ?? "").lowercased().contains(name.lowercased()) {
  app.activate(options: [.activateIgnoringOtherApps])
  exit(0)
}
exit(1)
