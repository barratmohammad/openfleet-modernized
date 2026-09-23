# Problem overview

Small trucking companies run dispatch and driver payroll on software like OpenFleet. That means home-grown or
abandoned Java apps that still work, still hold driver personal data and still calculate what people get paid.
Nobody wants to touch them.

OpenFleet shows the typical risks in one codebase:
- root database credentials committed to git
- CSRF turned off on the forms that change payroll inputs
- an end-of-life framework (Spring Boot 1.5, end of life 2019) on Java 8
- test tooling leaking into the production artifact
- payroll rules that nobody can prove are correct

A rewrite is too risky because payroll must not change. Leaving it alone is also a risk: it is a security and compliance liability.

**Enterprise value.** We used Opsera Forge to turn the legacy repo into a governed modernization backlog of 67 work orders
with acceptance criteria, then executed the highest-risk ones in place. Each change is traceable from a Forge
requirement to a work order, a PR, tests and evidence. The payroll golden master means every later refactor has to
prove it pays drivers exactly what they were paid before. That is what gets a finance team to approve a modernization.
