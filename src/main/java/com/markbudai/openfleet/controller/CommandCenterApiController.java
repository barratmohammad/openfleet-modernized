package com.markbudai.openfleet.controller;

import com.markbudai.openfleet.model.Employee;
import com.markbudai.openfleet.model.Location;
import com.markbudai.openfleet.model.Tractor;
import com.markbudai.openfleet.model.Trailer;
import com.markbudai.openfleet.model.TransferCost;
import com.markbudai.openfleet.model.Transport;
import com.markbudai.openfleet.pojo.Payout;
import com.markbudai.openfleet.services.EmployeeService;
import com.markbudai.openfleet.services.LocationService;
import com.markbudai.openfleet.services.PaymentService;
import com.markbudai.openfleet.services.TractorService;
import com.markbudai.openfleet.services.TrailerService;
import com.markbudai.openfleet.services.TransportService;
import org.springframework.data.util.Pair;
import org.springframework.http.ResponseEntity;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import javax.servlet.http.HttpServletRequest;
import java.security.Principal;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.Collections;
import java.util.Currency;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.stream.Collectors;

/**
 * Read API for the FleetOS Command Center UI.
 * Returns flat JSON with ISO-8601 dates and deliberately omits employee personal data
 * (tax number, social insurance number, driver's card number, birth data), unlike the legacy /api routes.
 */
@RestController
@RequestMapping("/api/v2")
public class CommandCenterApiController {

    private static final int INSPECTION_WARNING_DAYS = 30;

    private final TractorService tractorService;
    private final TrailerService trailerService;
    private final EmployeeService employeeService;
    private final LocationService locationService;
    private final TransportService transportService;
    private final PaymentService paymentService;

    /**
     * Creates the controller with the existing domain services.
     */
    public CommandCenterApiController(TractorService tractorService, TrailerService trailerService,
                                      EmployeeService employeeService, LocationService locationService,
                                      TransportService transportService, PaymentService paymentService) {
        this.tractorService = tractorService;
        this.trailerService = trailerService;
        this.employeeService = employeeService;
        this.locationService = locationService;
        this.transportService = transportService;
        this.paymentService = paymentService;
    }

    /**
     * Current user and the CSRF token the single-page UI must send with state-changing requests.
     */
    @GetMapping("/session")
    public Map<String, Object> session(Principal principal, HttpServletRequest request) {
        Map<String, Object> session = new LinkedHashMap<>();
        session.put("username", principal == null ? null : principal.getName());
        CsrfToken token = (CsrfToken) request.getAttribute(CsrfToken.class.getName());
        if (token != null) {
            session.put("csrfParameter", token.getParameterName());
            session.put("csrfHeader", token.getHeaderName());
            session.put("csrfToken", token.getToken());
        }
        session.put("today", LocalDate.now().toString());
        return session;
    }

    /**
     * Everything the Command Center renders, in one round trip.
     */
    @GetMapping("/snapshot")
    public Map<String, Object> snapshot() {
        LocalDate today = LocalDate.now();
        Map<String, Object> snapshot = new LinkedHashMap<>();
        snapshot.put("today", today.toString());
        snapshot.put("locations", nullSafe(locationService.getAllLocations()).stream()
                .map(CommandCenterApiController::location).collect(Collectors.toList()));
        snapshot.put("drivers", nullSafe(employeeService.getAllEmployees()).stream()
                .map(CommandCenterApiController::driver).collect(Collectors.toList()));
        snapshot.put("tractors", nullSafe(tractorService.getAllTractors()).stream()
                .map(t -> tractor(t, today)).collect(Collectors.toList()));
        snapshot.put("trailers", nullSafe(trailerService.getAllTrailers()).stream()
                .map(t -> trailer(t, today)).collect(Collectors.toList()));
        snapshot.put("transports", nullSafe(transportService.getAllTransports()).stream()
                .map(CommandCenterApiController::transport).collect(Collectors.toList()));
        return snapshot;
    }

    /**
     * Monthly driver payouts computed by the existing payroll engine, optionally converted.
     */
    @GetMapping("/payouts")
    public ResponseEntity<?> payouts(@RequestParam("year") int year, @RequestParam("month") int month,
                                     @RequestParam(value = "currency", defaultValue = "EUR") String currencyCode) {
        if (month < 1 || month > 12) {
            return ResponseEntity.badRequest().body(Collections.singletonMap("error", "month must be between 1 and 12"));
        }
        Currency currency;
        try {
            currency = Currency.getInstance(currencyCode);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Collections.singletonMap("error", "Unknown currency code: " + currencyCode));
        }
        List<Pair<Employee, Payout>> payouts = paymentService.getAllPayoutsInCurrency(year, month, currency);
        List<Map<String, Object>> rows = nullSafe(payouts).stream().map(pair -> {
            Map<String, Object> row = new LinkedHashMap<>();
            Employee employee = pair.getFirst();
            Payout payout = pair.getSecond();
            row.put("driverId", employee.getId());
            row.put("driverName", employee.getFirstName() + " " + employee.getLastName());
            row.put("workDays", payout.getWorkDays());
            row.put("restDays", payout.getRestDays());
            row.put("amount", payout.getAmount());
            row.put("currency", payout.getCurrency() == null ? currency.getCurrencyCode() : payout.getCurrency().getCurrencyCode());
            row.put("transportIds", nullSafe(payout.getBilledTransports()).stream()
                    .map(Transport::getId).collect(Collectors.toList()));
            return row;
        }).collect(Collectors.toList());
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("year", year);
        body.put("month", month);
        body.put("currency", currency.getCurrencyCode());
        body.put("rows", rows);
        return ResponseEntity.ok(body);
    }

    private static <T> List<T> nullSafe(List<T> list) {
        return list == null ? Collections.<T>emptyList() : list;
    }

    private static String iso(Object temporal) {
        return temporal == null ? null : temporal.toString();
    }

    private static Map<String, Object> location(Location l) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", l.getId());
        m.put("city", l.getCity());
        m.put("country", l.getCountry());
        m.put("region", l.getRegion());
        m.put("address", l.getStreet() + " " + l.getHouseNo() + ", " + l.getZipcode());
        return m;
    }

    private static Map<String, Object> driver(Employee e) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", e.getId());
        m.put("name", e.getFirstName() + " " + e.getLastName());
        m.put("homeCity", e.getPlaceOfLiving() == null ? null : e.getPlaceOfLiving().getCity());
        m.put("employedSince", iso(e.getEmploymentDate()));
        return m;
    }

    private static Map<String, Object> inspection(LocalDate due, LocalDate today) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("inspectionDue", iso(due));
        Long days = due == null ? null : ChronoUnit.DAYS.between(today, due);
        m.put("inspectionDaysRemaining", days);
        m.put("inspectionAlert", days != null && days <= INSPECTION_WARNING_DAYS);
        return m;
    }

    private static Map<String, Object> tractor(Tractor t, LocalDate today) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", t.getId());
        m.put("kind", "tractor");
        m.put("plate", t.getPlateNumber());
        m.put("make", t.getManufacturer());
        m.put("model", t.getType());
        m.put("vin", t.getChassisNumber());
        m.put("fuelNorm", t.getFuelNorm());
        m.put("weight", t.getWeight());
        m.put("maxWeight", t.getMaxWeight());
        m.put("built", iso(t.getDateOfManufacture()));
        m.putAll(inspection(t.getDateOfSupervision(), today));
        return m;
    }

    private static Map<String, Object> trailer(Trailer t, LocalDate today) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", t.getId());
        m.put("kind", "trailer");
        m.put("plate", t.getPlateNumber());
        m.put("make", t.getManufacturer());
        m.put("model", t.getType());
        m.put("vin", t.getChassisNumber());
        m.put("weight", t.getWeight());
        m.put("maxWeight", t.getMaxLoadWeight());
        m.put("built", iso(t.getDateOfManufacture()));
        m.putAll(inspection(t.getDateOfSupervision(), today));
        return m;
    }

    private static Map<String, Object> transport(Transport t) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", t.getId());
        m.put("driverId", t.getEmployee() == null ? null : t.getEmployee().getId());
        m.put("tractorId", t.getTractor() == null ? null : t.getTractor().getId());
        m.put("trailerId", t.getTrailer() == null ? null : t.getTrailer().getId());
        m.put("fromId", t.getPlaceOfLoad() == null ? null : t.getPlaceOfLoad().getId());
        m.put("toId", t.getPlaceOfUnload() == null ? null : t.getPlaceOfUnload().getId());
        m.put("start", iso(t.getStart()));
        m.put("finish", iso(t.getFinish()));
        m.put("loadedAt", iso(t.getTimeOfLoad()));
        m.put("unloadedAt", iso(t.getTimeOfUnload()));
        m.put("cargo", t.getCargoName());
        m.put("cargoWeight", t.getCargoWeight());
        m.put("cargoCount", t.getCargoCount());
        m.put("costs", nullSafe(t.getCosts()).stream().filter(Objects::nonNull).map(c -> cost(c)).collect(Collectors.toList()));
        return m;
    }

    private static Map<String, Object> cost(TransferCost c) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", c.getId());
        m.put("description", c.getCostDescription());
        m.put("amount", c.getAmount());
        m.put("currency", c.getCurrency() == null ? null : c.getCurrency().getCurrencyCode());
        m.put("date", iso(c.getDate()));
        return m;
    }
}
