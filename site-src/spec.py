# The tools page, tool by tool. Demo lines must be copied word for word from a
# real answer in captures.json (build.py checks). Prose is ours.

CAPTURED = "November 9, 2026"
BOARDSTAT_AS_OF = "November 9, 2026, with 311 requests through November 8"

GROUPS = [
    {
        "id": "report",
        "title": "Help reporting a problem",
        "intro": (
            "Tell it what's wrong in your own words. It finds the City's own 311 article for that "
            "problem, the agency that handles it, and every way to report it. It can also write a "
            "short report for you to paste in. It never files anything. You do that yourself."
        ),
        "tools": ["how_to_report", "draft_311_report", "list_311_categories"],
    },
    {
        "id": "district",
        "title": "Your community district or Council district",
        "intro": (
            "These read the files <a href=\"https://www.beta.nyc/boardstat/\">BoardStat</a> builds "
            "every night from NYC Open Data, with 311 requests from 2020 on. Every answer links to "
            "the BoardStat page with the same district, dates and problems, so you can check the "
            "numbers yourself. No API key needed."
        ),
        "tools": ["find_district", "district_summary", "top_problems", "problem_trend",
                  "agency_response", "still_open", "top_addresses", "address_history",
                  "find_requests", "boardstat_link", "boardstat_status"],
    },
    {
        "id": "ll47",
        "title": "The Local Law 47 reports",
        "intro": (
            "In 2005, <a href=\"https://intro.nyc/0174-2004\">Local Law 47</a> (Gale A. Brewer) "
            "required monthly 311 reports from the City, written into Charter § 1075. Two of those "
            "reports were repealed in 2023. We rebuilt all three from NYC Open Data. They are "
            "BetaNYC rebuilds, not the City's official reports, and every answer says so. "
            "No API key needed."
        ),
        "tools": ["ll47_service_request_report", "cb_monthly_list", "ll47_directory_assistance_report"],
    },
    {
        "id": "today",
        "title": "Today in the city",
        "intro": "The City's own 311 calendar and status alerts. These were in 1.1.0, too.",
        "tools": ["get_calendar", "get_status"],
    },
    {
        "id": "lookup",
        "title": "Look up a 311 request",
        "intro": (
            "Have a 311 number, like 311-12345678? These tell you where it stands, in words. "
            "The City sends a status code, and we translate it."
        ),
        "tools": ["get_service_request", "get_service_request_list"],
    },
    {
        "id": "about",
        "title": "About this server",
        "intro": (
            "Ask what changed in the server lately, who built it, or where its data comes from. Every "
            "BetaNYC MCP server is getting these three tools; nyc-311-mcp is the first. One reads the same list as the <a href=\"https://betanyc.github.io/nyc-311-mcp/whats-changed.html\">What's "
            "changed</a> page; another reads the server's list of data sources, which is also published as a <a href=\"https://github.com/BetaNYC/nyc-311-mcp/blob/HEAD/data.json\">data catalog</a>. No API key needed."
        ),
        "tools": ["whats_changed", "about_betanyc", "about_data"],
    },
]

TOOLS = {
    "how_to_report": {
        "status": "new", "key": True,
        "what": (
            "Describe the problem the way you'd tell a neighbor. It searches the City's 311 articles "
            "and gives back the best match: the article title and link on 311 Online, the agency, "
            "the 311 problem type, what the City says happens next, and every way to report it. "
            "Give it your district and it also tells you how often people there reported the same "
            "thing. If your description sounds dangerous, the first line tells you to call 911. "
            "It catches a lot, but it will miss some emergencies, so don't count on it for that."
        ),
        "asks": [
            "There's a pothole on my block that keeps getting bigger. How do I report it?",
            "My upstairs neighbor plays loud music every night.",
            "No heat in my apartment.",
            "Overflowing trash can and a broken bench in the park.",
        ],
        "demo": {
            "capture": 1,
            "prompt": "There's a pothole on my block that keeps getting bigger. How do I report it? I'm in Brooklyn Community District 6.",
            "lines": [
                '"first_line": "Best match: \\"Pothole or Cave-In on Street\\" (KA-01093), handled by the Department of Transportation, 311 problem type \\"Street Condition\\". Confidence strong. Article text as of 2026-11-09."',
                '"portal_url": "https://portal.311.nyc.gov/article/?kanumber=KA-01093"',
                '"call_911": "Call 911 to report an unprotected street opening that could cause an accident."',
                "…",
                '"label": "the last 365 days of data (2025-11-09 to 2026-11-08)"',
                '"requests": 1448',
            ],
            "caption": (
                "It found the City's pothole article, the agency, and the City's own warning about "
                "open holes. It also counted 1,448 street-condition reports in Brooklyn 6 over the "
                "past year."
            ),
        },
        "demo2": {
            "capture": 4,
            "prompt": "Smoke pouring out of the apartment next door",
            "lines": [
                '"first_line": "Call 911 to report smoke or fumes."',
                '"source": "311 article KA-02220 (\\"Smoke or Fumes\\"), https://portal.311.nyc.gov/article/?kanumber=KA-02220"',
                '"confidence": "strong: the City\'s own article for the danger detected; call 911 first"',
            ],
            "caption": "When a description sounds dangerous, the first line says to call 911, in the City's own words when the City has an article for it.",
        },
    },
    "draft_311_report": {
        "status": "new", "key": True,
        "what": (
            "Writes a short report you can paste into 311 Online: the problem, where, when, and what "
            "you saw. It doesn't fill in anything you didn't tell it. If something is missing, it "
            "marks the gap and asks you. It links the right 311 page, lists the City's Problem Detail options (from a 2024 "
            "City list, so they may be out of date), and says what happens after you report. It "
            "won't write a draft when it sees danger. It tells you to call 911 instead. It doesn't "
            "send anything or fill in any form."
        ),
        "asks": [
            "Help me write a 311 report about a pothole at 7th Avenue and 9th Street in Brooklyn. It's been there since last week.",
            "Draft a 311 report about a broken streetlight on my corner.",
        ],
        "demo": {
            "capture": 3,
            "prompt": "Help me write a 311 report about a pothole at 7th Avenue and 9th Street in Brooklyn. It's been there since last week.",
            "lines": [
                '"first_line": "Draft ready for \\"Pothole or Cave-In on Street\\" (KA-01093). The City does not publish each form\'s exact fields, so the form may ask for things this draft doesn\'t cover."',
                '"paste_text": "Problem: Pothole or Cave-In on Street (311 problem type: Street Condition)\\nWhere: 7th Avenue and 9th Street, Brooklyn\\nWhen: since last week\\nWhat I saw: pothole"',
                "…",
                '"not_sent": "This draft is not sent anywhere and the server files nothing. The person reports the problem themselves, on 311 Online, in the NYC311 app, by phone or by text."',
            ],
            "caption": "A draft to paste in yourself, the page to paste it on, and a reminder that nothing was sent.",
        },
    },
    "list_311_categories": {
        "status": "new", "key": True,
        "what": (
            "Browse 311's own topics, the same ones on 311 Online, when a match looks wrong or you "
            "just want to see what 311 covers. Pick a topic to list its articles, 20 at a time."
        ),
        "asks": ["What kinds of things can I report to 311?", "Show me 311's noise articles."],
        "demo": {
            "capture": 2,
            "prompt": "What kinds of things can I report to 311?",
            "lines": [
                '"name": "Benefits & Support"',
                '"description": "Affordable housing, homelessness, SNAP (food stamps), cash assistance, child care, volunteering, donating."',
                '"name": "Businesses & Consumers"',
                "…",
                '"count": 115',
            ],
            "caption": "311's 115 categories, with the City's own descriptions.",
        },
    },
    "find_district": {
        "status": "new", "key": False,
        "what": (
            "Type an address the way you normally would. It tells you the community district and "
            "the Council district, and how many 311 requests have been made there since 2020."
        ),
        "asks": ["What community board and Council district is 250 Broadway in?"],
        "demo": {
            "capture": 5,
            "prompt": "What community board and Council district is 250 Broadway in?",
            "lines": [
                '"message": "Found as 250 BROADWAY."',
                '"label": "Manhattan CD 1"',
                '"label": "Council District 1"',
                '"requests_at_this_address": 148',
            ],
            "caption": "250 Broadway is in Manhattan Community District 1 and Council District 1.",
        },
    },
    "district_summary": {
        "status": "new", "key": False,
        "what": (
            "The big picture for one district: how many requests, how many aren't closed, how long "
            "they take to close, and the top problems. For each top problem, it compares the "
            "district's share with the borough's and the city's."
        ),
        "asks": ["Give me a summary of 311 in Brooklyn Community Board 6.", "What does 311 look like in Council District 7 this fiscal year?"],
        "demo": {
            "capture": 6,
            "prompt": "Give me a summary of 311 in Brooklyn Community Board 6.",
            "lines": [
                '"label": "2025-11-01 to 2026-11-08"',
                '"requests": 59922',
                '"not_closed": 3580',
                '"median_days_to_close": 0.2',
                "…",
                '"problem": "Illegal Parking"',
                '"district_share": 0.2836',
                '"borough_share": 0.2011',
                '"city_share": 0.1588',
            ],
            "caption": "59,922 requests in a year. Illegal parking is 28% of Brooklyn 6's requests, compared with 20% in Brooklyn and 16% citywide.",
        },
    },
    "top_problems": {
        "status": "new", "key": False,
        "what": "The most-reported problems in a district for any period, next to the same days a year earlier.",
        "asks": ["What were the top 311 complaints in Brooklyn 6 in the last 30 days?", "Top problems in Council District 39 last fiscal year?"],
        "demo": {
            "capture": 7,
            "prompt": "What were the top 311 complaints in Brooklyn 6 in the last 30 days?",
            "lines": [
                '"label": "the last 30 days of data (2026-10-10 to 2026-11-08)"',
                '"problem": "Illegal Parking"',
                '"requests": 2313',
                '"same_days_a_year_earlier": 1297',
                '"change_pct": 78.3',
            ],
            "caption": "Illegal parking reports were up 78.3% from the same 30 days a year earlier.",
        },
    },
    "problem_trend": {
        "status": "new", "key": False,
        "what": "One problem, month by month, in one district, with the same days a year earlier next to each month.",
        "asks": ["How has residential noise in Brooklyn 6 changed month to month this year?"],
        "demo": {
            "capture": 8,
            "prompt": "How has residential noise in Brooklyn 6 changed month to month this year?",
            "lines": [
                '"problem": "Noise - Residential"',
                '"requests": 2676',
                '"month": "2025-12"',
                '"requests": 184',
                '"same_days_a_year_earlier": 152',
                "…",
            ],
            "caption": "2,676 residential noise reports in a year, with every month next to the year before.",
        },
    },
    "agency_response": {
        "status": "new", "key": False,
        "what": (
            "For each agency: how many requests, how many are closed, and the median and average "
            "days to close. Remember that closed doesn't mean fixed."
        ),
        "asks": ["How fast do agencies close requests in Council District 39?", "Which agency is slowest in Bronx 1 this fiscal year?"],
        "demo": {
            "capture": 9,
            "prompt": "How fast do agencies close requests in Council District 39?",
            "lines": [
                '"agency_name": "Department of Housing Preservation and Development"',
                '"requests": 2067',
                '"not_closed": 467',
                '"median_days_to_close": 6',
                '"average_days_to_close": 10.3',
            ],
            "caption": "Over the last 90 days, HPD took a median of 6 days to close a request in Council District 39.",
        },
    },
    "still_open": {
        "status": "new", "key": False,
        "what": (
            "Requests that aren't closed yet, oldest first, with how many days each has been open "
            "and a count by agency. The City doesn't define its statuses, so we explain each one "
            "and label the explanation as ours."
        ),
        "asks": ["What 311 requests in Brooklyn 6 are still open?", "Which agency has the most open requests in Queens 1?"],
        "demo": {
            "capture": 10,
            "prompt": "What 311 requests in Brooklyn 6 are still open?",
            "lines": [
                '"not_closed": 9372',
                '"agency_name": "Department of Parks and Recreation"',
                '"not_closed": 2238',
                "…",
                '"problem": "New Tree Request"',
                '"status": "In Progress"',
                '"days_open": 2503.4',
            ],
            "caption": "9,372 requests aren't closed. The oldest, a request for a new tree, has been open for over 2,500 days.",
        },
    },
    "top_addresses": {
        "status": "new", "key": False,
        "what": "The addresses with the most requests in a district, with each one's most common problem. You can narrow it to one problem.",
        "asks": ["Which addresses in Brooklyn 6 get the most 311 requests?", "Where are the most heat complaints in Bronx 5?"],
        "demo": {
            "capture": 11,
            "prompt": "Which addresses in Brooklyn 6 get the most 311 requests?",
            "lines": [
                '"label": "the last 90 days of data (2026-08-11 to 2026-11-08)"',
                '"requests": 15637',
                "…",
                '"requests": 921',
                '"most_common_problem": "Illegal Parking"',
                "…",
                '"address_count": 5521',
            ],
            "caption": "The busiest address had 921 requests in 90 days, mostly illegal parking. (We left the addresses out of this page.)",
        },
    },
    "address_history": {
        "status": "new", "key": False,
        "what": (
            "Every request at one address since 2020, newest first, with the status explained and "
            "the agency's own resolution text. It's the closest thing to looking up a request when "
            "you don't have its number."
        ),
        "asks": ["What's been reported at 1 Centre Street?", "Any open requests at City Hall?"],
        "demo": {
            "capture": 12,
            "prompt": "What's been reported at 1 Centre Street?",
            "lines": [
                '"requests": 358',
                '"not_closed": 9',
                "…",
                '"problem": "Graffiti"',
                '"status": "Closed"',
                '"resolution": "The City has removed the graffiti from this property."',
            ],
            "caption": "358 requests at the Municipal Building since 2020, with what the agency said about each one.",
        },
    },
    "find_requests": {
        "status": "new", "key": False,
        "what": (
            "Every request in a district, newest first, a page at a time. Filter by problem, agency, "
            "or status, including the City's own statuses like Pending."
        ),
        "asks": ["Show me the newest street-condition requests in Brooklyn 6.", "List DOT requests in Manhattan 3 that are Pending."],
        "demo": {
            "capture": 13,
            "prompt": "Show me the newest street-condition requests in Brooklyn 6.",
            "lines": [
                '"requests": 1464',
                '"status": "Closed"',
                '"requests": 1373',
                "…",
                '"description": "Cave-in"',
                '"agency": "DOT"',
                '"status": "In Progress"',
            ],
            "caption": "1,464 street-condition requests in a year, by status, newest first.",
        },
    },
    "boardstat_link": {
        "status": "new", "key": False,
        "what": "Makes a BoardStat link with your district, dates, problem, agency, and status already set, so you can open the map and charts yourself.",
        "asks": ["Give me a BoardStat link for residential noise in Brooklyn 6, last 90 days."],
        "demo": {
            "capture": 14,
            "prompt": "Give me a BoardStat link for residential noise in Brooklyn 6, last 90 days.",
            "lines": [
                '"boardstat_url": "https://www.beta.nyc/boardstat/district.html?geo=cd&id=306&start=2026-08-11&end=2026-11-08&type=Noise+-+Residential"',
            ],
            "caption": "One link, ready to open or share.",
        },
    },
    "boardstat_status": {
        "status": "new", "key": False,
        "what": "How fresh BoardStat's data is, and whether last night's build ran late. Ask this when a number looks off.",
        "asks": ["How fresh is BoardStat's data?"],
        "demo": {
            "capture": 15,
            "prompt": "How fresh is BoardStat's data?",
            "lines": [
                '"built_at": "2026-11-10T00:37:17Z"',
                '"nightly_run_late": false',
                '"newest_request": "2026-11-08 02:06:22"',
                '"total": 23080603',
            ],
            "caption": "Over 23 million requests, and whether last night's build ran late. If it had, the tool would say so.",
        },
    },
    "ll47_service_request_report": {
        "status": "new", "key": False,
        "what": (
            "Rebuilds the monthly report on requests for service, formerly Charter § 1075(b): totals "
            "by category, agency, and status, and the average and median days to close, for a month "
            "and for the fiscal year to date. Citywide, by borough, or for one district."
        ),
        "asks": ["Rebuild the Local Law 47 monthly 311 report for Brooklyn 6.", "Run the § 1075(b) report for Queens for October."],
        "demo": {
            "capture": 16,
            "prompt": "Rebuild the Local Law 47 monthly 311 report for Brooklyn 6.",
            "lines": [
                '"label": "2026-10 (2026-10-01 to 2026-10-31)"',
                '"requests": 6108',
                '"closed": 5227',
                "…",
                '"status": "repealed"',
                '"note": "This is a BetaNYC rebuild from NYC Open Data, not the City\'s official report. Only the City can meet § 1075."',
            ],
            "caption": "October's report for Brooklyn 6, with the law it rebuilds and a plain note that the law was repealed.",
        },
    },
    "cb_monthly_list": {
        "status": "new", "key": False,
        "what": (
            "The list that Charter § 1075(d), still law, says community boards should get: one "
            "district's requests for a month, every older request still unresolved, and the ones "
            "closed since. Comes in pages, or as a CSV."
        ),
        "asks": ["Give Brooklyn Community Board 6 its monthly list of 311 requests for October.", "Same list for Staten Island 1, as a CSV."],
        "demo": {
            "capture": 17,
            "prompt": "Give Brooklyn Community Board 6 its monthly list of 311 requests for October.",
            "lines": [
                '"new_this_month": 6108',
                '"unresolved_from_prior_months": 8167',
                '"unresolved_at_month_end_now_closed": 29',
                '"rows": 14304',
            ],
            "caption": "6,108 new requests in October, and 8,167 older ones still unresolved.",
        },
    },
    "ll47_directory_assistance_report": {
        "status": "new", "key": False,
        "what": (
            "Calls answered by 311 agents, by topic, for a month and the fiscal year to date, "
            "formerly Charter § 1075(c). This one is limited, and the answer says so: the open data "
            "can't separate out directory-assistance calls, and its agency column is blank. NYC Open "
            "Data can be slow here, so the first full-year answer may take a few tries."
        ),
        "asks": ["How many calls did 311 agents answer in October, by topic?"],
        "demo": {
            "capture": 20,
            "prompt": "How many calls did 311 agents answer in fiscal year 2026, by topic?",
            "lines": [
                '"limited": true',
                '"note": "Some months are still loading from NYC Open Data, so the full total is not ready yet. The others keep loading and are saved when done. Ask again in a minute."',
            ],
            "caption": "When NYC Open Data is slow, it says what's missing and keeps loading. It doesn't guess.",
        },
    },
    "get_calendar": {
        "status": "same", "key": True,
        "what": "Alternate side parking, trash and recycling collection, and schools, for a day or up to 90 days.",
        "asks": ["Is alternate side parking in effect today?", "Is trash pickup on schedule the week of Thanksgiving?"],
        "demo": {
            "capture": 0,
            "prompt": "Is alternate side parking in effect today?",
            "lines": [
                '"details": "Alternate side parking and meters are in effect."',
                '"details": "Trash, recycling, and compost collections are on schedule."',
                '"details": "Public schools are open."',
            ],
            "caption": "The City's calendar for today.",
        },
    },
    "get_status": {
        "status": "improved", "key": True,
        "what": "Whether Code Blue, a fire hydrant emergency, snow or ice, or an emergency management alert is in effect right now. The answer now says it in words.",
        "asks": ["Is there a Code Blue tonight?", "Is there a snow emergency on the streets?"],
        "demo": {
            "capture": 18,
            "prompt": "Is there a Code Blue tonight?",
            "lines": [
                '"answer": "No: the City\'s 311 API says Code Blue is not in effect right now. That is as of when it was asked; it can change later today, so ask again for a later answer."',
            ],
            "caption": "A yes or no, and when it was true.",
        },
    },
    "get_service_request": {
        "status": "improved", "key": True,
        "what": (
            "Look up a request by its 311 number. You get the agency, the problem, the status in "
            "words, and the agency's own note about what it did. ZIP codes are removed."
        ),
        "asks": ["What happened with 311 request 311-17323508?"],
        "demo": {
            "capture": 19,
            "prompt": "What happened with 311 request 311-17323508?",
            "lines": [
                '"Agency": "Department of Sanitation"',
                '"Problem": "Snow or Ice"',
                '"ResolutionAction": "The Department of Sanitation investigated this complaint and issued a Notice of Violation."',
                '"status": "Closed"',
            ],
            "caption": "The City sends status code 614110003. The tool says Closed. (We left the address out of this page.)",
        },
    },
    "get_service_request_list": {
        "status": "improved", "key": True,
        "what": "Several 311 numbers at once. Any number the City can't find is listed, so nothing quietly goes missing.",
        "asks": ["Check these three 311 numbers for me: …"],
    },
    "whats_changed": {
        "status": "new13", "key": False,
        "what": (
            "What changed in this server, newest first: new tools, data fixes, and corrections "
            "when an answer was wrong. You can ask for corrections only, or for changes since a date."
        ),
        "asks": ["What's new in the 311 server?", "Has the 311 server ever corrected a wrong answer?"],
    },
    "about_betanyc": {
        "status": "new13", "key": False,
        "what": (
            "Who built this server, where to report a bug in this server or ask for a new feature, and links to "
            "BetaNYC's events, newsletter, and ways to get involved."
        ),
        "asks": ["Who made this 311 tool?", "Where do I report a bug in the 311 server?"],
    },
    "about_data": {
        "status": "new13", "key": False,
        "what": (
            "Tells you where each answer's data comes from. It names the publisher and says whether the "
            "numbers are an official record or BetaNYC's own, what BetaNYC changed, and how current the data "
            "is on your computer. It also gives what the data leaves out, the credit line to use, where to "
            "check a number with the City, and where to report a mistake."
        ),
        "asks": ["Where do the 311 district numbers come from?", "Are these 311 numbers official?", "How current is the 311 data?"],
    },
}
