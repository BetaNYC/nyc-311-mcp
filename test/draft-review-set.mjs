// The #18 review set: the 20 descriptions of the #17 review (test/review-set.mjs),
// drafted as a person would ask, with no address, time or borough (so the draft must ask
// for them); then 10 harder ones: a missing address, emergencies, a problem outside what
// 311 takes, two problems in one, contact details and a ZIP code in the person's words.
import { REVIEW } from "./review-set.mjs";

export const COMMON = REVIEW.map((r) => ({ id: `C${r.rank}`, args: { description: r.description }, expect_ka: r.expect_ka, note: r.complaint_type }));

export const TRICKY = [
  { id: "T1", kind: "missing address", args: { description: "there's a pothole", borough: "Queens", when: "this morning", ongoing: "still happening" }, expect_ka: "KA-01093", expect_placeholders: ["[add: where]"] },
  { id: "T2", kind: "address, no borough", args: { description: "mice and roaches in my apartment", location: "123 Main Street", when: "every night", ongoing: "keeps happening" }, expect_ka: "KA-02278", expect_placeholders: ["[add: borough]"] },
  { id: "T3", kind: "vague, no match", args: { description: "something is broken outside" }, expect_ka: null },
  { id: "T4", kind: "emergency", args: { description: "I smell gas in my kitchen", location: "45 Elm St", borough: "Bronx" }, emergency: true },
  { id: "T5", kind: "emergency", args: { description: "there's a fire in the building next door" }, emergency: true },
  { id: "T6", kind: "emergency mixed with a 311 problem", args: { description: "someone got hurt in a car crash and there is a pothole" }, emergency: true },
  { id: "T7", kind: "not 311 (City says it does not take it)", args: { description: "my neighbor's cooking odor comes into my apartment" }, expect_ka: null },
  { id: "T8", kind: "two problems", args: { description: "loud music from the bar downstairs and mice in my apartment", location: "200 Bedford Ave", borough: "Brooklyn" }, expect_kas: ["KA-01085", "KA-02278"] },
  { id: "T9", kind: "two problems", args: { description: "trash and litter all over the sidewalk; also someone is blocking my driveway", location: "Grand Concourse and E 161 St", borough: "Bronx", when: "Nov 6, 7 pm" }, expect_kas: ["KA-01803", "KA-01062"] },
  { id: "T10", kind: "contact details and a ZIP in the person's words", args: { description: "no heat in my apartment, call me at 917-555-0123 or jane@example.com", location: "10 W 100 St, New York, NY 10025", borough: "Manhattan", when: "since Tuesday", ongoing: "still happening" }, expect_ka: "KA-01036" },
];
