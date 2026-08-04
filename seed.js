const criteria = [
  { id: "impact", name: "Impact", description: "How meaningful is the solution for its intended users?", weight: 30 },
  { id: "innovation", name: "Innovation", description: "How original and inventive is the approach?", weight: 25 },
  { id: "execution", name: "Technical execution", description: "How well is the solution designed and implemented?", weight: 25 },
  { id: "presentation", name: "Presentation", description: "How clearly did the team communicate and demonstrate it?", weight: 20 }
];

const categories = [
  { id: "sustainability", name: "Sustainable Cities", company: "GreenGrid", color: "#147d64" },
  { id: "health", name: "Future of Health", company: "NovaHealth", color: "#8b5cf6" },
  { id: "inclusion", name: "Digital Inclusion", company: "ConnectCo", color: "#e8673f" }
];

const teams = [
  ["t01", "Sprout", "sustainability", "Table S01", "A neighbourhood food-waste exchange that turns scraps into local compost."],
  ["t02", "Watt Wise", "sustainability", "Table S02", "Real-time energy coaching for shared housing."],
  ["t03", "ClearRoute", "sustainability", "Table S03", "Lower-carbon routing for last-mile delivery fleets."],
  ["t04", "Second Serve", "sustainability", "Table S04", "Matching surplus event catering with community kitchens."],
  ["t05", "PulsePal", "health", "Table H01", "Accessible recovery guidance after outpatient care."],
  ["t06", "Nightlight", "health", "Table H02", "A private, low-friction mental wellbeing check-in."],
  ["t07", "Care Circle", "health", "Table H03", "Medication coordination for families and caregivers."],
  ["t08", "AirAware", "health", "Table H04", "Hyperlocal air-quality alerts for vulnerable residents."],
  ["t09", "Open Door", "inclusion", "Table I01", "Plain-language navigation for essential public services."],
  ["t10", "Signpost", "inclusion", "Table I02", "Live indoor wayfinding designed for visual accessibility."],
  ["t11", "Bridge", "inclusion", "Table I03", "Voice-first digital literacy for older adults."],
  ["t12", "Common Ground", "inclusion", "Table I04", "Community-led translation for neighbourhood information."]
].map(([id, name, categoryId, table, summary]) => ({ id, name, categoryId, table, summary }));

const users = [
  { id: "j-green", name: "Maya Chen", email: "company@lifehack.test", password: "judge2026", role: "judge", judgeType: "company", companyCategoryId: "sustainability" },
  { id: "j-general", name: "Prof. Alex Tan", email: "judge@lifehack.test", password: "judge2026", role: "judge", judgeType: "general" },
  { id: "j-general-2", name: "Dr. Sam Lee", email: "sam@lifehack.test", password: "judge2026", role: "judge", judgeType: "general" },
  { id: "admin", name: "Event Operations", email: "admin@lifehack.test", password: "admin2026", role: "admin" }
];

module.exports = { criteria, categories, teams, users };
