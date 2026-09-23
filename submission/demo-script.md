# Demo script (about 3 minutes)

Setup before recording: `docker compose up -d --build`, then log in once at http://localhost:8081 (admin / password).
Have tabs open: GitHub legacy repo, Forge FleetOS project, this repo's PR list, the running app.

1. **The legacy problem (0:00–0:30).** Show the devshiro/openfleet-legacy repo: `application.properties` with root/password,
   `WebSecurityConfig` with `.csrf().disable()` and the hardcoded LDAP URL, `pom.xml` with Spring Boot 1.5.2.
   Say: "2017 fleet and payroll app. Nobody wants to touch it because it pays drivers."
2. **Forge understands it (0:30–1:10).** In Forge: ForgeScore 52 "Developing" and the radar. Click into one finding.
   Show the generated PRD and architecture, then the work-order board with 67 stories.
   Open WO-013 to show the acceptance criteria and implementation steps.
3. **Executing work orders (1:10–1:50).** Show the PR list: nine PRs, eight tagged `[WO-xxx]`. Open PR #7 (WO-023)
   and show the evidence. Back in Forge, show WO-023 in review with the evidence comment, commit SHA and PR link.
   Mention that the Forge commit hook blocks a `[WO-]` commit until the checklist is done.
4. **It works (1:50–2:30).** Terminal: `docker compose up`, the whole stack in one command. App: log in and show the
   dashboard counts, the Tractors page with NFL-101 in the "Days Remaining" inspection alert, and
   Employees → Payouts for last month in EUR, then HUF (a live rate from the Hungarian National Bank SOAP service).
   Avoid USD: the legacy payouts page renders nothing for it.
   Then prove CSRF:
   ```
   curl -b cookies -d "..." localhost:8081/transport/job/add   # -> 403 without token
   ```
5. **What Forge-driven testing found (2:30–3:00).** Open `payroll-golden-master.csv`. The legacy code bills 35 days
   into a 31-day month when a trip crosses the month boundary. "We pinned it instead of silently changing payroll,
   and raised it in Forge as a business decision. That is the difference between modernizing and rewriting."
   Close on the numbers table in `before-after.md`.
