<!-- DRAFT: rewrite in your own words. Judges disqualify generic AI text.
     Fill every [bracket] from your own experience, and add 3+ screenshots. -->

I spent SF Enterprise Hackathon 2.0 modernizing a 2017 trucking-fleet app with Opsera Forge, and the most useful thing
it found was a payroll bug.

The app is OpenFleet: Spring Boot 1.5, Java 8, LDAP login, MySQL. It handles dispatch, trucks and trailers, and monthly
driver pay. It had root/password committed to git and CSRF switched off on the forms that feed payroll.
[One sentence on why you picked it: e.g. a fleet/payroll system you've seen at work, or why "it pays people" matters.]

How I used Forge:
- Imported the repo and got a ForgeScore of 52/100 ("Developing"). [Screenshot: radar]
- Forge generated an intent profile, PRD, architecture options and 67 work orders with acceptance criteria.
  [Name one thing it got right that surprised you, and one thing you corrected.]
- I connected Claude Code to Forge's MCP server. Each story went through claim → implement → Forge commit checklist
  → `[WO-xxx]` commit → PR → evidence posted back to the work order. [Screenshot: a work order with its evidence comment]

What shipped in the day: 8 work orders, covering externalized secrets, dev/prod profiles, a 38-route security inventory,
CSRF back on, the JUnit 5 migration, a Docker Compose stack and a payroll golden master. Tests went from 60 to 96.

The payroll golden master found something: when a trip starts on 28 Dec and ends in January, the legacy code bills
35 days into a 31-day month. We pinned current behavior instead of "fixing" pay silently, and raised it in Forge
for a business decision. [Your take: what this says about modernizing systems that move money.]

What was hard: [e.g. old MySQL driver vs MySQL 8, iCloud fighting the Maven build, a Forge AC that said 30 routes
when there were 38.]
What I learned: [your words]

Repo: https://github.com/barratmohammad/openfleet-modernized
#SFEnterpriseHackathon #OpseraForge [tag @Opsera]
