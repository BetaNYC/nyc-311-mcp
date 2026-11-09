// The #17 review set. The 20 most common problem types (complaint_type) citywide in
// BoardStat's agg/month_type.parquet, 2025-11 to 2026-10 (build 2026-11-07T10:36:39Z;
// DuckDB: sum(n) where geo_kind = 'city', grouped by complaint_type). open_data_agency
// is the agency on those requests in BoardStat's detail files (the largest share first).
// expect_ka is the 311 article a resident should land on, chosen by reading the
// City's articles (recorded in test/fixtures/content/GetContent/).
export const REVIEW = [
  { rank: 1, complaint_type: "Illegal Parking", requests: 615825, open_data_agency: "NYPD", description: "a car is parked in front of the fire hydrant on my street", expect_ka: "KA-01986" },
  { rank: 2, complaint_type: "Noise - Residential", requests: 418059, open_data_agency: "NYPD", description: "loud music next door at 2 am", expect_ka: "KA-01017" },
  { rank: 3, complaint_type: "HEAT/HOT WATER", requests: 353662, open_data_agency: "HPD", description: "no heat in my apartment", expect_ka: "KA-01036" },
  { rank: 4, complaint_type: "Blocked Driveway", requests: 196322, open_data_agency: "NYPD", description: "someone parked and is blocking my driveway", expect_ka: "KA-01062" },
  { rank: 5, complaint_type: "Noise - Street/Sidewalk", requests: 174291, open_data_agency: "NYPD", description: "people yelling and playing loud music on the sidewalk", expect_ka: "KA-01092" },
  { rank: 6, complaint_type: "UNSANITARY CONDITION", requests: 139650, open_data_agency: "HPD", description: "mice and roaches in my apartment", expect_ka: "KA-02278" },
  { rank: 7, complaint_type: "Plumbing", requests: 89186, open_data_agency: "HPD (DOB for some)", description: "my toilet is broken and the landlord won't fix it", expect_ka: "KA-01074" },
  { rank: 8, complaint_type: "Street Condition", requests: 79303, open_data_agency: "DOT", description: "a pothole on my block", expect_ka: "KA-01093" },
  { rank: 9, complaint_type: "Abandoned Vehicle", requests: 71676, open_data_agency: "NYPD", description: "a car has been abandoned on my street for weeks", expect_ka: "KA-02130" },
  { rank: 10, complaint_type: "PAINT/PLASTER", requests: 69465, open_data_agency: "HPD", description: "the paint is peeling and the plaster on my apartment ceiling is cracked", expect_ka: "KA-01074" },
  { rank: 11, complaint_type: "Dirty Condition", requests: 69162, open_data_agency: "DSNY", description: "trash and litter all over the sidewalk", expect_ka: "KA-01803" },
  { rank: 12, complaint_type: "Water System", requests: 63180, open_data_agency: "DEP", description: "a fire hydrant is open and running", expect_ka: "KA-01034" },
  { rank: 13, complaint_type: "Snow or Ice", requests: 62596, open_data_agency: "DSNY", description: "the sidewalk wasn't shoveled and it's icy", expect_ka: "KA-01397" },
  { rank: 14, complaint_type: "Noise - Commercial", requests: 60965, open_data_agency: "NYPD", description: "loud music from the bar downstairs", expect_ka: "KA-01085" },
  { rank: 15, complaint_type: "Noise", requests: 60704, open_data_agency: "DEP", description: "construction jackhammer noise early in the morning", expect_ka: "KA-01091" },
  { rank: 16, complaint_type: "DOOR/WINDOW", requests: 54635, open_data_agency: "HPD", description: "the lock on my apartment door is broken and the landlord won't fix it", expect_ka: "KA-01074" },
  { rank: 17, complaint_type: "Traffic Signal Condition", requests: 53700, open_data_agency: "DOT", description: "the traffic light at the corner is broken", expect_ka: "KA-01404" },
  { rank: 18, complaint_type: "Noise - Vehicle", requests: 51918, open_data_agency: "NYPD", description: "a car honking its horn and blasting music all night", expect_ka: "KA-01102" },
  { rank: 19, complaint_type: "WATER LEAK", requests: 49304, open_data_agency: "HPD", description: "water leaking from the ceiling in my apartment", expect_ka: "KA-01509" },
  { rank: 20, complaint_type: "Encampment", requests: 46279, open_data_agency: "NYPD (DHS for about a third)", description: "a homeless encampment under the overpass", expect_ka: "KA-02253" },
];
