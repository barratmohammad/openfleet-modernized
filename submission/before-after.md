# OpenFleet → FleetOS: before and after

## Before (legacy OpenFleet, 2017)
OpenFleet is a Spring Boot 1.5.2 / Java 8 monolith for small trucking companies: drivers, tractors,
trailers, locations, transport jobs, costs, monthly driver payroll and currency-converted payout reports.
Nobody has touched it since 2017.

| Problem | Evidence |
|---|---|
| Committed production credentials | `spring.datasource.username=root`, `password=password` in `application.properties` |
| Hardcoded LDAP directory | `ldap://localhost:8389/` and `dc=openfleet,dc=org` literals in `WebSecurityConfig` |
| CSRF protection switched off | `.csrf().disable()` on a cookie-session, form-login app |
| No way to run it | Needs a hand-installed MySQL; no Docker, no compose, no seed data |
| Test tooling from 2014 | JUnit 4.12 and `mockito-all` 1.10.19 with **no scope**, which put a 1.2 MB Mockito jar in the production artifact |
| Payroll logic untested at the edges | No golden master; a 400-line service mixes payout, work-day intervals, performance and a SOAP FX call |
| ForgeScore | **52 / 100, "Developing"** |

## What Forge produced
Forge imported the repo and produced a ForgeScore, an intent profile, BRD, PRD, architecture options,
a UI design spec, a requirements traceability matrix and **67 work orders across 9 epics**, each with
acceptance criteria, file lists and implementation steps.

## After (this repository)
Eight Forge work orders were implemented, each on its own branch with a `[WO-xxx]` commit, a PR, acceptance-criteria
evidence posted back to Forge, and dev activity reported through Forge MCP.

| WO | What changed | Proof |
|---|---|---|
| WO-007 | `docker-compose.yml` with MySQL 5.7 and OpenLDAP loading the existing LDIF | `compose config`, both services healthy, LDAP bind as admin |
| WO-001 | Datasource and LDAP settings externalized to `OPENFLEET_*`; `WebSecurityConfig` built from injected config | 7 new tests; no credentials in `application.properties` |
| WO-002 | `dev` / `prod` profiles; prod has placeholders only; no default profile | Prod and no-profile startups exit 1 on missing config |
| WO-004 | Executable route inventory of all 38 controller routes | Reflection test fails if a route is added without a security expectation |
| WO-012 | CSRF protection re-enabled | Authenticated POST without token → 403 |
| WO-023 | CSRF tokens in all employee and transport forms | Live app: tokenless POST 403, form submit 200 and persisted |
| WO-005 | JUnit Jupiter 5.10 + mockito-core 4.11, Surefire 3.2.5 | Mockito no longer shipped in the production jar |
| WO-013 | Payroll golden master (13 scenarios, offline FX fake) | Found a real payroll defect (below) |

Plus one non-Forge commit: a Dockerfile, a compose `app` service and demo seed data, so the app runs with
`docker compose up -d --build`.

**Numbers**

| | Before | After |
|---|---|---|
| Automated tests | 60 (2 failing) | 96 (same 2 legacy failures) |
| Committed credentials | yes | none |
| CSRF | disabled | enforced |
| Local run | manual MySQL install | one command |
| Forge work orders done | 0 / 67 | 8 / 67 (in review) |

## Found along the way
- **Payroll defect.** A transport that starts on 28 December and finishes in January bills all its December days to January.
  The golden master shows 28 work days + 7 rest days = 35 days in a 31-day month. It is pinned rather than silently
  fixed, and raised in Forge as a payroll decision.
- Forge's WO-004 said 30 routes; the controllers actually declare 38. All 38 are covered, and the gap is raised in Forge.
- The legacy `logback.xml` sends Spring's own errors to a localhost syslog, so startup failures are invisible (belongs to Forge WO-057/062).

## Next on the Forge board
Payroll service extraction (WO-024/025/036), lookup APIs without PII (WO-028/029), then the staged
Spring Boot 2.7 → Jakarta migration (WO-050/059).
