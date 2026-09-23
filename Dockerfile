# syntax=docker/dockerfile:1
# Build stage: the legacy build still targets Java 8 and runs wsimport against the MNB WSDL.
FROM maven:3.9-eclipse-temurin-8 AS build
WORKDIR /src
COPY pom.xml .
COPY src ./src
RUN --mount=type=cache,target=/root/.m2 mvn -B -q -DskipTests package

# Runtime stage: JRE only, non-root user.
FROM eclipse-temurin:8-jre
RUN useradd --system --uid 10001 openfleet
WORKDIR /app
COPY --from=build /src/target/openfleet-0.1.jar /app/openfleet.jar
USER openfleet
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/openfleet.jar"]
