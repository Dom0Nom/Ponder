/**
 * Bundled exam outlines. They follow the published exam structure (subject areas and domains),
 * not the full official item lists; each carries a link to the official guide.
 */
export interface CurriculumTopic {
  id: string;
  title: string;
  /** a few words that describe what the topic covers; used for search and question generation */
  description: string;
  group: string;
  prereqs?: string[];
}

export interface Curriculum {
  id: string;
  title: string;
  language: string;
  officialUrl: string;
  note: string;
  topics: CurriculumTopic[];
}

const t = (group: string, id: string, title: string, description: string, prereqs?: string[]): CurriculumTopic => ({
  id,
  title,
  description,
  group,
  prereqs,
});

export const CURRICULA: Curriculum[] = [
  {
    id: "ged",
    title: "GED (all four subjects)",
    language: "en",
    officialUrl: "https://ged.com/about_test/test_subjects/",
    note: "Outline of the four GED subject tests by content area. Check the official GED assessment targets for detail.",
    topics: [
      t("Math", "ged.math.numbers", "Number sense and operations", "whole numbers, fractions, decimals, order of operations, absolute value"),
      t("Math", "ged.math.ratios", "Ratios, rates and proportions", "unit rates, proportions, scale, unit conversion", ["ged.math.numbers"]),
      t("Math", "ged.math.percents", "Percents", "percent of a number, percent change, interest, discounts", ["ged.math.ratios"]),
      t("Math", "ged.math.exponents", "Exponents, roots and scientific notation", "powers, square roots, cube roots, scientific notation", ["ged.math.numbers"]),
      t("Math", "ged.math.geometry", "Geometry and measurement", "perimeter, area, circles, volume, surface area, Pythagorean theorem", ["ged.math.exponents"]),
      t("Math", "ged.math.data", "Data, statistics and probability", "mean, median, mode, range, graphs and tables, simple probability", ["ged.math.percents"]),
      t("Math", "ged.math.expressions", "Algebraic expressions and polynomials", "variables, evaluating and simplifying expressions, factoring, polynomials", ["ged.math.exponents"]),
      t("Math", "ged.math.linear", "Linear equations and inequalities", "solving one-variable equations and inequalities, word problems", ["ged.math.expressions"]),
      t("Math", "ged.math.graphs", "Lines, slope and functions", "coordinate plane, slope, intercepts, linear functions, function notation", ["ged.math.linear"]),
      t("Math", "ged.math.systems", "Systems of equations", "solving two linear equations together, substitution, elimination", ["ged.math.linear"]),
      t("Math", "ged.math.quadratics", "Quadratic equations", "factoring quadratics, quadratic formula, graphs of parabolas", ["ged.math.expressions"]),
      t("Reasoning Through Language Arts", "ged.rla.reading", "Reading for meaning", "main idea, supporting details, inference, sequence, word meaning in context"),
      t("Reasoning Through Language Arts", "ged.rla.arguments", "Analyzing arguments and evidence", "claims, evidence, author's purpose, comparing two texts", ["ged.rla.reading"]),
      t("Reasoning Through Language Arts", "ged.rla.grammar", "Grammar and usage", "subject-verb agreement, pronouns, verb tense, frequently confused words"),
      t("Reasoning Through Language Arts", "ged.rla.mechanics", "Sentence structure and mechanics", "run-ons, fragments, punctuation, capitalization, transitions", ["ged.rla.grammar"]),
      t("Reasoning Through Language Arts", "ged.rla.essay", "Extended response essay", "argumentative essay analyzing two passages, structure, evidence", ["ged.rla.arguments", "ged.rla.mechanics"]),
      t("Science", "ged.sci.life", "Life science", "cells, human body systems, health, genetics and heredity, evolution, ecosystems"),
      t("Science", "ged.sci.physical", "Physical science", "matter, atoms, chemical reactions, forces, motion, energy, waves"),
      t("Science", "ged.sci.earth", "Earth and space science", "Earth's systems, weather, natural resources, the solar system"),
      t("Science", "ged.sci.practices", "Science practices", "hypotheses, experimental design, variables, reading data and graphs, probability in science"),
      t("Social Studies", "ged.ss.civics", "Civics and government", "US Constitution, branches of government, rights, federalism, elections"),
      t("Social Studies", "ged.ss.history", "United States history", "colonial era, revolution, civil war, civil rights, world wars, cold war"),
      t("Social Studies", "ged.ss.economics", "Economics", "supply and demand, markets, inflation, government role in the economy"),
      t("Social Studies", "ged.ss.geography", "Geography and the world", "maps, regions, population, environment and human activity"),
      t("Social Studies", "ged.ss.sources", "Reading sources, maps and charts", "primary and secondary sources, point of view, interpreting maps, graphs and data"),
    ],
  },
  {
    id: "sat",
    title: "SAT (digital)",
    language: "en",
    officialUrl: "https://satsuite.collegeboard.org/sat/whats-on-the-test",
    note: "The four Reading and Writing and four Math content domains of the digital SAT, with their skills.",
    topics: [
      t("Reading and Writing", "sat.rw.info", "Information and Ideas", "central ideas and details, command of evidence (textual and quantitative), inferences"),
      t("Reading and Writing", "sat.rw.craft", "Craft and Structure", "words in context, text structure and purpose, cross-text connections"),
      t("Reading and Writing", "sat.rw.expression", "Expression of Ideas", "rhetorical synthesis from notes, transitions"),
      t("Reading and Writing", "sat.rw.conventions", "Standard English Conventions", "sentence boundaries, punctuation, form, structure and sense, verb and pronoun agreement"),
      t("Math", "sat.math.algebra", "Algebra", "linear equations in one and two variables, linear functions, systems of linear equations, linear inequalities"),
      t("Math", "sat.math.advanced", "Advanced Math", "equivalent expressions, nonlinear equations and systems, quadratic and exponential functions", ["sat.math.algebra"]),
      t("Math", "sat.math.data", "Problem-Solving and Data Analysis", "ratios, rates, proportions, units, percentages, one- and two-variable data, probability, sampling and statistical claims"),
      t("Math", "sat.math.geometry", "Geometry and Trigonometry", "area and volume, lines, angles and triangles, right triangle trigonometry, circles", ["sat.math.algebra"]),
    ],
  },
  {
    id: "ap-bio",
    title: "AP Biology",
    language: "en",
    officialUrl: "https://apcentral.collegeboard.org/courses/ap-biology",
    note: "The eight units of the AP Biology course framework.",
    topics: [
      t("AP Biology", "apbio.1", "Unit 1: Chemistry of Life", "water, macromolecules, carbohydrates, lipids, proteins, nucleic acids"),
      t("AP Biology", "apbio.2", "Unit 2: Cell Structure and Function", "organelles, membranes, transport, cell size, compartmentalization", ["apbio.1"]),
      t("AP Biology", "apbio.3", "Unit 3: Cellular Energetics", "enzymes, photosynthesis, cellular respiration, ATP", ["apbio.2"]),
      t("AP Biology", "apbio.4", "Unit 4: Cell Communication and Cell Cycle", "signal transduction, feedback, mitosis, cell cycle regulation", ["apbio.2"]),
      t("AP Biology", "apbio.5", "Unit 5: Heredity", "meiosis, Mendelian genetics, non-Mendelian inheritance, chromosomal inheritance", ["apbio.4"]),
      t("AP Biology", "apbio.6", "Unit 6: Gene Expression and Regulation", "DNA replication, transcription, translation, gene regulation, mutations, biotechnology", ["apbio.5"]),
      t("AP Biology", "apbio.7", "Unit 7: Natural Selection", "evolution, Hardy-Weinberg, speciation, phylogeny, evidence for evolution", ["apbio.5"]),
      t("AP Biology", "apbio.8", "Unit 8: Ecology", "energy flow, populations, communities, ecosystems, biodiversity"),
    ],
  },
  {
    id: "ap-calc-ab",
    title: "AP Calculus AB",
    language: "en",
    officialUrl: "https://apcentral.collegeboard.org/courses/ap-calculus-ab",
    note: "The eight units of the AP Calculus AB course framework.",
    topics: [
      t("AP Calculus AB", "apcalc.1", "Unit 1: Limits and Continuity", "limits, one-sided limits, continuity, intermediate value theorem"),
      t("AP Calculus AB", "apcalc.2", "Unit 2: Differentiation: Definition and Fundamental Properties", "derivative definition, power rule, product and quotient rules", ["apcalc.1"]),
      t("AP Calculus AB", "apcalc.3", "Unit 3: Differentiation: Composite, Implicit, and Inverse Functions", "chain rule, implicit differentiation, inverse functions", ["apcalc.2"]),
      t("AP Calculus AB", "apcalc.4", "Unit 4: Contextual Applications of Differentiation", "rates of change, related rates, linearization, L'Hospital's rule", ["apcalc.3"]),
      t("AP Calculus AB", "apcalc.5", "Unit 5: Analytical Applications of Differentiation", "mean value theorem, extrema, concavity, optimization", ["apcalc.3"]),
      t("AP Calculus AB", "apcalc.6", "Unit 6: Integration and Accumulation of Change", "Riemann sums, definite integrals, fundamental theorem of calculus, antiderivatives", ["apcalc.2"]),
      t("AP Calculus AB", "apcalc.7", "Unit 7: Differential Equations", "slope fields, separation of variables, exponential growth and decay", ["apcalc.6"]),
      t("AP Calculus AB", "apcalc.8", "Unit 8: Applications of Integration", "average value, area between curves, volumes of solids", ["apcalc.6"]),
    ],
  },
  {
    id: "ihk-fiae",
    title: "IHK Fachinformatiker/in Anwendungsentwicklung",
    language: "de",
    officialUrl: "https://www.ihk-aka.de",
    note: "Gliederung nach der Ausbildungsordnung 2020 (Abschlussprüfung Teil 1 und Teil 2). Den aktuellen Prüfungskatalog deiner IHK prüfen.",
    topics: [
      t("AP Teil 1: IT-Arbeitsplatz", "fiae.ap1.kunde", "Kundenanforderungen analysieren", "Kundenberatung, Anforderungen aufnehmen, Lastenheft und Pflichtenheft"),
      t("AP Teil 1: IT-Arbeitsplatz", "fiae.ap1.hardware", "Hardware und Software auswählen", "Komponenten, Betriebssysteme, Lizenzen, Angebotsvergleich, Nutzwertanalyse"),
      t("AP Teil 1: IT-Arbeitsplatz", "fiae.ap1.wirtschaft", "Kosten und Wirtschaftlichkeit", "Kalkulation, Amortisation, Leasing, Kaufentscheidung"),
      t("AP Teil 1: IT-Arbeitsplatz", "fiae.ap1.netz", "Netzwerke", "IPv4, IPv6, Subnetting, OSI-Modell, Switch, Router, DHCP, DNS"),
      t("AP Teil 1: IT-Arbeitsplatz", "fiae.ap1.sicherheit", "IT-Sicherheit und Datenschutz", "Schutzziele, DSGVO, Backup, Verschlüsselung, Zugriffsrechte"),
      t("AP Teil 1: IT-Arbeitsplatz", "fiae.ap1.qs", "Qualitätssicherung und Übergabe", "Testen, Abnahme, Dokumentation, Einweisung"),
      t("AP Teil 2: Software planen", "fiae.ap2.anforderung", "Anforderungsanalyse und Projektplanung", "Projektmanagement, Netzplan, Gantt, agile Methoden, Scrum", ["fiae.ap1.kunde"]),
      t("AP Teil 2: Software planen", "fiae.ap2.uml", "Softwaredesign mit UML", "Klassendiagramm, Sequenzdiagramm, Use-Case, Aktivitätsdiagramm, Entwurfsmuster"),
      t("AP Teil 2: Software planen", "fiae.ap2.db", "Datenbanken und SQL", "ER-Modell, Normalisierung, SELECT, JOIN, GROUP BY, Transaktionen"),
      t("AP Teil 2: Algorithmen", "fiae.ap2.algo", "Algorithmen und Datenstrukturen", "Pseudocode, Sortieren, Suchen, Rekursion, Arrays, Listen, Komplexität"),
      t("AP Teil 2: Algorithmen", "fiae.ap2.oop", "Objektorientierte Programmierung", "Klassen, Vererbung, Polymorphie, Schnittstellen, Kapselung", ["fiae.ap2.algo"]),
      t("AP Teil 2: Algorithmen", "fiae.ap2.test", "Testen und Qualitätssicherung von Software", "Unit-Tests, Testfälle, Black-Box, White-Box, Code-Review", ["fiae.ap2.oop"]),
      t("AP Teil 2: WiSo", "fiae.wiso.ausbildung", "Berufsausbildung und Arbeitsrecht", "Ausbildungsvertrag, BBiG, Kündigung, Arbeitszeit, Jugendarbeitsschutz"),
      t("AP Teil 2: WiSo", "fiae.wiso.sozial", "Sozialversicherung und Tarifrecht", "Kranken-, Renten-, Arbeitslosen-, Pflege-, Unfallversicherung, Tarifvertrag, Betriebsrat"),
      t("AP Teil 2: WiSo", "fiae.wiso.betrieb", "Betrieb und Wirtschaft", "Rechtsformen, Unternehmensziele, Marktformen, Wirtschaftskreislauf"),
    ],
  },
];

export const curriculumById = (id: string) => CURRICULA.find((c) => c.id === id);
