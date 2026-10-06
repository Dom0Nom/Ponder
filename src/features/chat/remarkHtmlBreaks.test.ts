import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "./Markdown";

const render = (text: string) => renderToStaticMarkup(createElement(Markdown, { text })).replace(/<br\/>\n/g, "<br/>");

describe("model-emitted <br>", () => {
  it("renders <br> variants as line breaks", () => {
    const out = render("one<br>two<br/>three<BR />four");
    expect(out).toBe('<div class="prose-chat"><p>one<br/>two<br/>three<br/>four</p></div>');
  });
  it("handles <br> inside table cells", () => {
    expect(render("| a |\n|---|\n| x<br>y |")).toContain("<td>x<br/>y</td>");
  });
  it("keeps other raw HTML escaped", () => {
    const out = render('hi <img src=x onerror="alert(1)"> there');
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;img");
  });
});
