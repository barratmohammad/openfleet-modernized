package tests.controller;

import com.markbudai.openfleet.controller.CommandCenterApiController;
import com.markbudai.openfleet.model.Employee;
import com.markbudai.openfleet.model.Transport;
import com.markbudai.openfleet.pojo.Payout;
import com.markbudai.openfleet.services.EmployeeService;
import com.markbudai.openfleet.services.LocationService;
import com.markbudai.openfleet.services.PaymentService;
import com.markbudai.openfleet.services.TractorService;
import com.markbudai.openfleet.services.TrailerService;
import com.markbudai.openfleet.services.TransportService;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.data.util.Pair;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.security.web.csrf.DefaultCsrfToken;
import tests.supplier.EmployeeSupplier;
import tests.supplier.LocationSupplier;
import tests.supplier.TractorSupplier;
import tests.supplier.TrailerSupplier;
import tests.supplier.TransportSupplier;

import java.time.LocalDate;
import java.util.Collections;
import java.util.Currency;
import java.util.List;
import java.util.Map;

/**
 * Contract tests for the Command Center read API: flat DTOs, ISO dates, no employee personal data.
 */
public class CommandCenterApiControllerTest {

    private TractorService tractors;
    private TrailerService trailers;
    private EmployeeService employees;
    private LocationService locations;
    private TransportService transports;
    private PaymentService payments;
    private CommandCenterApiController controller;

    @BeforeEach
    public void setUp() {
        tractors = Mockito.mock(TractorService.class);
        trailers = Mockito.mock(TrailerService.class);
        employees = Mockito.mock(EmployeeService.class);
        locations = Mockito.mock(LocationService.class);
        transports = Mockito.mock(TransportService.class);
        payments = Mockito.mock(PaymentService.class);
        controller = new CommandCenterApiController(tractors, trailers, employees, locations, transports, payments);
    }

    @Test
    @SuppressWarnings("unchecked")
    public void snapshotReturnsFlatDtosWithoutPersonalData() {
        Mockito.when(employees.getAllEmployees()).thenReturn(Collections.singletonList(EmployeeSupplier.getSampleEmployee()));
        Mockito.when(locations.getAllLocations()).thenReturn(Collections.singletonList(LocationSupplier.getSampleLocation()));
        Mockito.when(tractors.getAllTractors()).thenReturn(Collections.singletonList(TractorSupplier.getSampleTractor()));
        Mockito.when(trailers.getAllTrailers()).thenReturn(Collections.singletonList(TrailerSupplier.getSampleTrailer()));
        Mockito.when(transports.getAllTransports()).thenReturn(Collections.singletonList(TransportSupplier.getSampleTransport()));

        Map<String, Object> snapshot = controller.snapshot();

        Map<String, Object> driver = ((List<Map<String, Object>>) snapshot.get("drivers")).get(0);
        Assertions.assertEquals("John Shepard", driver.get("name"));
        for (String secret : new String[]{"socialInsuranceNo", "taxNo", "driversCardNo", "mothersName", "dateOfBirth", "placeOfBirth"}) {
            Assertions.assertFalse(driver.containsKey(secret), secret + " must not be exposed");
        }
        Map<String, Object> job = ((List<Map<String, Object>>) snapshot.get("transports")).get(0);
        Assertions.assertTrue(job.get("start") instanceof String, "dates must be ISO strings");
        Assertions.assertEquals(1L, job.get("driverId"));
        Map<String, Object> tractor = ((List<Map<String, Object>>) snapshot.get("tractors")).get(0);
        Assertions.assertTrue(tractor.containsKey("inspectionDaysRemaining"));
        Assertions.assertEquals(LocalDate.now().toString(), snapshot.get("today"));
    }

    @Test
    public void inspectionAlertIsRaisedWithinThirtyDays() {
        com.markbudai.openfleet.model.Tractor soon = TractorSupplier.getSampleTractor();
        soon.setDateOfSupervision(LocalDate.now().plusDays(12));
        Mockito.when(tractors.getAllTractors()).thenReturn(Collections.singletonList(soon));
        @SuppressWarnings("unchecked")
        Map<String, Object> t = ((List<Map<String, Object>>) controller.snapshot().get("tractors")).get(0);
        Assertions.assertEquals(12L, t.get("inspectionDaysRemaining"));
        Assertions.assertEquals(Boolean.TRUE, t.get("inspectionAlert"));
    }

    @Test
    @SuppressWarnings("unchecked")
    public void payoutsDelegateToPayrollEngine() {
        Employee employee = EmployeeSupplier.getSampleEmployee();
        Payout payout = new Payout();
        payout.setWorkDays(10);
        payout.setRestDays(21);
        payout.setAmount(500);
        payout.setCurrency(Currency.getInstance("EUR"));
        payout.setBilledTransport(Collections.<Transport>singletonList(TransportSupplier.getSampleTransport()));
        Mockito.when(payments.getAllPayoutsInCurrency(2026, 8, Currency.getInstance("EUR")))
                .thenReturn(Collections.singletonList(Pair.of(employee, payout)));

        ResponseEntity<?> response = controller.payouts(2026, 8, "EUR");

        Assertions.assertEquals(200, response.getStatusCodeValue());
        Map<String, Object> body = (Map<String, Object>) response.getBody();
        Map<String, Object> row = ((List<Map<String, Object>>) body.get("rows")).get(0);
        Assertions.assertEquals(500L, row.get("amount"));
        Assertions.assertEquals(10L, row.get("workDays"));
        Assertions.assertEquals(Collections.singletonList(1L), row.get("transportIds"));
    }

    @Test
    public void payoutsRejectInvalidInput() {
        Assertions.assertEquals(400, controller.payouts(2026, 13, "EUR").getStatusCodeValue());
        Assertions.assertEquals(400, controller.payouts(2026, 8, "XYZ").getStatusCodeValue());
        Mockito.verifyNoInteractions(payments);
    }

    @Test
    public void sessionExposesCsrfTokenForTheSinglePageUi() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setAttribute(CsrfToken.class.getName(), new DefaultCsrfToken("X-CSRF-TOKEN", "_csrf", "abc123"));
        Map<String, Object> session = controller.session(() -> "admin", request);
        Assertions.assertEquals("admin", session.get("username"));
        Assertions.assertEquals("_csrf", session.get("csrfParameter"));
        Assertions.assertEquals("abc123", session.get("csrfToken"));
    }
}
