import Cocoa
// Prints "<windowId> <x> <y> <w> <h>" of the first normal window whose owner matches the regex.
let pattern = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "ponder|Ponder"
let re = try! NSRegularExpression(pattern: pattern, options: [.caseInsensitive])
let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as! [[String: Any]]
for w in list {
  let owner = (w[kCGWindowOwnerName as String] as? String) ?? ""
  let layer = (w[kCGWindowLayer as String] as? Int) ?? 0
  let b = w[kCGWindowBounds as String] as? [String: CGFloat] ?? [:]
  if layer == 0, re.firstMatch(in: owner, range: NSRange(owner.startIndex..., in: owner)) != nil, (b["Width"] ?? 0) > 400 {
    print(w[kCGWindowNumber as String] as! Int, Int(b["X"] ?? 0), Int(b["Y"] ?? 0), Int(b["Width"] ?? 0), Int(b["Height"] ?? 0))
    exit(0)
  }
}
exit(1)
