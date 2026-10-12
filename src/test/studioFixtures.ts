/** Canned model replies for Studio outputs, keyed by the prompt's first line. */
const OUTPUTS: [RegExp, object | string][] = [
  [
    /^A learner explains[\s\S]*THEIR ANSWER TO YOUR LAST QUESTION/,
    {
      clarity: 4,
      verdict: "Much clearer: you now say where the carbon comes from.",
      strengths: ["Carbon from carbon dioxide in the air"],
      gaps: ["The Calvin cycle uses ATP and NADPH to build the sugar."],
      mistakes: [],
      jargon: [],
      question: "What do ATP and NADPH do in the Calvin cycle?",
    },
  ],
  [
    /^A learner explains/,
    {
      clarity: 2,
      verdict: "You have the main idea that plants make sugar from light, but the place and the raw materials need fixing.",
      strengths: ["Plants turn light energy into sugar"],
      gaps: ["The Calvin cycle fixes carbon dioxide into sugar.", "Chlorophyll in the chloroplasts absorbs the light."],
      mistakes: [{ said: "in their mitochondria", correct: "Photosynthesis happens in the chloroplasts, not the mitochondria." }],
      jargon: [],
      question: "If the sugar isn't made of light, where does its carbon come from?",
    },
  ],
  [
    /^Create a study report/,
    {
      title: "How photosynthesis works",
      markdown:
        "Photosynthesis turns light energy into chemical energy stored in glucose [1]. It runs in two linked stages inside the chloroplast, and both depend on each other [1].\n\n## Light reactions\n\nIn the thylakoid membranes, chlorophyll absorbs light and splits water, which releases oxygen and produces ATP and NADPH [1]. These carriers move the captured energy to the next stage.\n\n## Calvin cycle\n\nIn the stroma, the enzyme RuBisCO fixes carbon dioxide, and ATP and NADPH power the reduction of the fixed carbon into sugar [1]. The cycle regenerates its starting molecule so it can keep running.\n\n## Limiting factors\n\nLight intensity, carbon dioxide concentration and temperature each limit the overall rate when they are in short supply [1].\n\n## Key takeaways\n\n- Light energy becomes chemical energy [1].\n- Oxygen comes from split water [1].\n- The Calvin cycle builds sugar from carbon dioxide [1].",
    },
  ],
  [
    /^Create a one-page cheat sheet/,
    {
      title: "Photosynthesis cheat sheet",
      markdown:
        "## Equation\n\n- $6CO_2 + 6H_2O \\rightarrow C_6H_{12}O_6 + 6O_2$\n\n## Where\n\n- **Thylakoid**: light reactions\n- **Stroma**: Calvin cycle\n\n## Products\n\n- **ATP** and **NADPH** carry energy\n- **Oxygen** comes from water\n\n## Common mistakes\n\n- Oxygen does not come from carbon dioxide\n- The Calvin cycle needs light indirectly",
    },
  ],
  [
    /^Create a printable worksheet/,
    {
      title: "Photosynthesis worksheet",
      instructions: "Answer each question in your own words, then check the answer key.",
      questions: [
        { q: "Where in the cell does photosynthesis happen?", kind: "short", answer: "In the chloroplasts" },
        { q: "Which gas is released?", kind: "choice", options: ["Oxygen", "Nitrogen", "Carbon dioxide", "Helium"], answer: "Oxygen" },
        { q: "The ____ cycle fixes carbon dioxide.", kind: "fill", answer: "Calvin" },
        { q: "Name the two energy carriers made in the light reactions.", kind: "short", answer: "ATP and NADPH" },
      ],
    },
  ],
  [
    /^Create a timeline/,
    {
      title: "Discovering photosynthesis",
      events: [
        { date: "1648", title: "Van Helmont weighs a willow", detail: "Showed the tree's mass didn't come from soil." },
        { date: "1771", title: "Priestley's mouse and mint", detail: "Plants restore air that a candle used up." },
        { date: "1779", title: "Ingenhousz finds light matters", detail: "Only green parts in light restore the air." },
        { date: "1950s", title: "Calvin maps the cycle", detail: "Traced carbon through the dark reactions." },
      ],
    },
  ],
  [
    /^Create a data table/,
    {
      title: "Light reactions vs Calvin cycle",
      caption: "Compares the two stages of photosynthesis.",
      columns: ["Stage", "Location", "Inputs", "Outputs"],
      rows: [
        ["Light reactions", "Thylakoid", "Light, water", "ATP, NADPH, oxygen"],
        ["Calvin cycle", "Stroma", "CO2, ATP, NADPH", "Sugar"],
      ],
    },
  ],
  [
    /^Create a mind map/,
    {
      title: "Photosynthesis map",
      root: {
        label: "Photosynthesis",
        children: [
          { label: "Light reactions", children: [{ label: "Thylakoid", children: [] }, { label: "Water split", children: [] }] },
          { label: "Calvin cycle", children: [{ label: "Stroma", children: [] }, { label: "RuBisCO", children: [] }] },
          { label: "Limiting factors", children: [{ label: "Light", children: [] }, { label: "CO2", children: [] }] },
        ],
      },
    },
  ],
  [
    /^Create a Mermaid diagram/,
    {
      title: "Photosynthesis flow",
      code: 'flowchart TD\n  A["Light"] --> B["Light reactions"]\n  W["Water"] --> B\n  B --> O["Oxygen"]\n  B --> C["ATP + NADPH"]\n  C --> D["Calvin cycle"]\n  CO["CO2"] --> D\n  D --> G["Glucose"]',
    },
  ],
  [
    /^Create a slide deck/,
    {
      title: "Photosynthesis in 5 slides",
      slides: [
        { title: "Photosynthesis", bullets: [], notes: "A short tour of how plants make sugar." },
        { title: "Two stages", bullets: ["Light reactions in the thylakoid", "Calvin cycle in the stroma"], notes: "Both stages depend on each other." },
        { title: "Light reactions", bullets: ["Chlorophyll absorbs light", "Water is split", "ATP and NADPH form"], notes: "Oxygen comes from the split water." },
        { title: "Summary", bullets: ["Light becomes chemical energy", "Sugar is built from CO2"], notes: "Recap the two stages." },
      ],
    },
  ],
  [
    /^Create a one-page infographic/,
    {
      title: "Photosynthesis at a glance",
      subtitle: "How plants turn light into sugar.",
      stats: [
        { value: "2", label: "linked stages" },
        { value: "6 O2", label: "per glucose made" },
      ],
      sections: [
        { heading: "Light reactions", points: ["Chlorophyll absorbs light", "Water splits into oxygen"] },
        { heading: "Calvin cycle", points: ["RuBisCO fixes CO2", "ATP and NADPH build sugar"] },
        { heading: "Limits", points: ["Light, CO2 and temperature"] },
      ],
      takeaway: "Light energy ends up stored in glucose.",
    },
  ],
  [
    /^Create a two-host audio overview script/,
    {
      title: "How leaves make sugar",
      lines: [
        { host: "A", text: "Every breath you take comes from a leaf splitting water. That's where photosynthesis starts." },
        { host: "B", text: "Wait, the oxygen comes from water, not from carbon dioxide?" },
        { host: "A", text: "Right. In the light reactions, chlorophyll absorbs light and the energy splits water. Oxygen is what's left over." },
        { host: "B", text: "And the energy doesn't just disappear." },
        { host: "A", text: "It's stored in ATP and NADPH, which the Calvin cycle then uses to fix carbon dioxide into sugar." },
        { host: "B", text: "So, to remember: light reactions make the energy carriers, the Calvin cycle spends them to build sugar." },
      ],
    },
  ],
  [
    /^Create a small interactive explainer/,
    [
      "TITLE: Light and the rate of photosynthesis",
      "```html",
      "<p>Move the slider to change how much light reaches the leaf. Watch how the rate of photosynthesis rises and then levels off once something else becomes the limit.</p>",
      '<label>Light intensity: <input id="light" type="range" min="0" max="100" value="40"> <output id="lv">40</output>%</label>',
      '<p>Rate of photosynthesis: <strong id="rate">0</strong> units</p>',
      '<svg viewBox="0 0 200 20" width="100%" height="20"><rect id="bar" x="0" y="0" height="20" width="0" fill="var(--primary)"></rect></svg>',
      "<script>",
      "const light = document.getElementById('light');",
      "const draw = () => { const v = Number(light.value); const r = Math.round(100 * (1 - Math.exp(-v / 30))); document.getElementById('lv').textContent = v; document.getElementById('rate').textContent = r; document.getElementById('bar').setAttribute('width', r * 2); };",
      "light.addEventListener('input', draw); draw();",
      "</script>",
      "```",
    ].join("\n"),
  ],
  [
    /^A listener interrupts an audio overview/,
    { lines: [{ host: "A", text: "Good question. The Calvin cycle happens in the stroma, the fluid around the thylakoids." }] },
  ],
  [
    /^Write a short spoken study briefing/,
    {
      text: "Good morning. The one thing that matters today is your Biology review: twenty minutes on the Calvin cycle. After that, clear the flashcards that are due, and take a second look at the question you missed about chloroplasts. Start with the review now, while you're fresh.",
    },
  ],
];

export function studioReply(prompt: string): string | null {
  const hit = OUTPUTS.find(([re]) => re.test(prompt));
  return hit ? (typeof hit[1] === "string" ? hit[1] : JSON.stringify(hit[1])) : null;
}
