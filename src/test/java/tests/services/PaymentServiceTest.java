package tests.services;

import com.markbudai.openfleet.pojo.Payout;
import com.markbudai.openfleet.services.EmployeeService;
import com.markbudai.openfleet.services.implementations.PaymentServiceImpl;
import com.markbudai.openfleet.services.TransportService;
import com.markbudai.openfleet.model.Employee;
import com.markbudai.openfleet.model.Transport;
import com.markbudai.openfleet.services.PaymentService;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.BeforeAll;
import com.markbudai.openfleet.services.ExchangeService;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.data.util.Pair;
import tests.supplier.EmployeeSupplier;
import tests.supplier.TransportSupplier;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.math.BigDecimal;
import java.math.MathContext;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Currency;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * Created by Mark on 2017. 05. 13..
 */
public class PaymentServiceTest {

    private static EmployeeService mockedEmployeeService;
    private static TransportService mockedTransportService;

    private static PaymentService service;

    @BeforeAll
    public static void init(){
        mockedEmployeeService = EmployeeSupplier.getMockProvider();
        mockedTransportService = TransportSupplier.getMockProvider();
        service = new PaymentServiceImpl(mockedEmployeeService, mockedTransportService);
    }

    @Test
    public void testPayoutGeneration(){
        Employee employee = EmployeeSupplier.getSampleEmployee();
        Payout payout = service.getPayout(employee,2017,LocalDate.now().getMonthValue());
        Assertions.assertEquals(500,payout.getAmount());
        Assertions.assertEquals(10,payout.getWorkDays());
    }

    @Test
    public void testWorkDays(){
        List<Transport> transports = TransportSupplier.getDateList();
        Assertions.assertEquals(32,service.getWorkDays(transports));
    }

    @Test
    public void testWorkDaysAgainst3TransportsOnOneDay(){
        List<Transport> transports = TransportSupplier.getTransportsOnSameDay();
        Assertions.assertEquals(1,service.getWorkDays(transports));
    }

    @Test
    public void testDriversPerformanceEval(){
        mockedTransportService = Mockito.mock(TransportService.class);
        Mockito.when(mockedTransportService.getTransportByEmployee(EmployeeSupplier.getSampleEmployee()))
                .thenReturn(TransportSupplier.getDateList());
        PaymentService service = new PaymentServiceImpl(mockedEmployeeService,mockedTransportService);
        Assertions.assertEquals(0.8,service.getDriversPerformance(2017,1).get(0).getSecond().getFirst(),0.001);
        Assertions.assertEquals(0.2,service.getDriversPerformance(2017,1).get(0).getSecond().getSecond(),0.001);
    }

    // ---- Payroll golden master (WO-013) ------------------------------------------------------

    private static final Map<String, Double> HUF_PER_UNIT = new HashMap<>();
    static {
        HUF_PER_UNIT.put("EUR", 310.0);
        HUF_PER_UNIT.put("USD", 280.0);
        HUF_PER_UNIT.put("HUF", 1.0);
    }

    /** Deterministic stand-in for the MNB SOAP service, using HUF as pivot currency like the real adapter. */
    static ExchangeService fakeExchange() {
        return new ExchangeService() {
            @Override
            public double getExchangeRateForCurrency(Currency currency) {
                return HUF_PER_UNIT.getOrDefault(currency.getCurrencyCode(), -1.0);
            }

            @Override
            public BigDecimal exchange(Currency from, BigDecimal amount, Currency to) {
                BigDecimal inHuf = amount.multiply(new BigDecimal(HUF_PER_UNIT.get(from.getCurrencyCode())));
                if ("HUF".equals(to.getCurrencyCode())) {
                    return inHuf;
                }
                return inHuf.divide(new BigDecimal(HUF_PER_UNIT.get(to.getCurrencyCode())), MathContext.DECIMAL64);
            }
        };
    }

    private static List<Transport> scenario(String name) {
        switch (name) {
            case "overlapping": return TransportSupplier.getDateList();
            case "same-day": return TransportSupplier.getTransportsOnSameDay();
            case "past-month": return Collections.singletonList(TransportSupplier.getAnotherMonthsSampleTransport());
            default: throw new IllegalArgumentException("Unknown golden-master scenario: " + name);
        }
    }

    private static PaymentServiceImpl serviceFor(Employee employee, List<Transport> transports) {
        EmployeeService employees = Mockito.mock(EmployeeService.class);
        Mockito.when(employees.listAllStoredEmployees()).thenReturn(Collections.singletonList(employee));
        TransportService transportService = Mockito.mock(TransportService.class);
        Mockito.when(transportService.getTransportByEmployee(employee)).thenReturn(transports);
        return new PaymentServiceImpl(employees, transportService, PaymentServiceTest::fakeExchange);
    }

    private static List<String[]> goldenRows() throws IOException {
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(
                PaymentServiceTest.class.getResourceAsStream("/payroll-golden-master.csv"), StandardCharsets.UTF_8))) {
            return reader.lines().filter(l -> !l.startsWith("#") && !l.startsWith("scenario") && !l.trim().isEmpty())
                    .map(l -> l.split(",")).collect(Collectors.toList());
        }
    }

    @Test
    public void goldenMasterMatchesLegacyPayroll() throws IOException {
        Employee employee = EmployeeSupplier.getSampleEmployee();
        List<String> mismatches = new ArrayList<>();
        List<String[]> rows = goldenRows();
        Assertions.assertTrue(rows.size() >= 10, "golden master fixture must not be empty");
        for (String[] row : rows) {
            String scenario = row[0];
            int year = Integer.parseInt(row[1]);
            int month = Integer.parseInt(row[2]);
            Currency currency = Currency.getInstance(row[3]);
            PaymentServiceImpl service = serviceFor(employee, scenario(scenario));

            Payout payout = service.getPayout(employee, year, month);
            List<Pair<Employee, Payout>> converted = service.getAllPayoutsInCurrency(year, month, currency);
            long amount = converted.isEmpty() ? 0 : converted.get(0).getSecond().getAmount();

            String actual = payout.getWorkDays() + "," + payout.getRestDays() + "," + amount + "," + converted.size();
            String expected = row[4] + "," + row[5] + "," + row[6] + "," + row[7];
            if (!expected.equals(actual)) {
                mismatches.add(String.join(",", Arrays.copyOf(row, 4)) + " expected " + expected + " but was " + actual);
            }
        }
        Assertions.assertTrue(mismatches.isEmpty(), "Payroll drifted from golden master: " + mismatches);
    }

    @Test
    public void pastMonthPayoutIsFiftyEuroPerWorkDay() {
        Employee employee = EmployeeSupplier.getSampleEmployee();
        Payout payout = serviceFor(employee, scenario("past-month")).getPayout(employee, 2017, 4);
        Assertions.assertEquals(10, payout.getWorkDays());
        Assertions.assertEquals(500, payout.getAmount());
        Assertions.assertEquals(Currency.getInstance("EUR"), payout.getCurrency());
    }

    @Test
    public void currentMonthPayoutCountsWorkDaysSoFar() {
        Employee employee = EmployeeSupplier.getSampleEmployee();
        LocalDate first = LocalDate.now().withDayOfMonth(1);
        Transport transport = new Transport();
        transport.setEmployee(employee);
        transport.setStart(LocalDateTime.of(first, java.time.LocalTime.of(6, 0)));
        transport.setFinish(LocalDateTime.of(first.plusDays(2), java.time.LocalTime.of(18, 0)));

        Payout payout = serviceFor(employee, Collections.singletonList(transport))
                .getPayout(employee, first.getYear(), first.getMonthValue());

        Assertions.assertEquals(3, payout.getWorkDays());
        Assertions.assertEquals(150, payout.getAmount());
    }

    @Test
    public void noWorkMonthProducesEmptyPayoutAndNoReportRow() {
        Employee employee = EmployeeSupplier.getSampleEmployee();
        PaymentServiceImpl service = serviceFor(employee, scenario("overlapping"));
        Payout payout = service.getPayout(employee, 2017, 3);
        Assertions.assertTrue(payout.isEmpty());
        Assertions.assertTrue(service.getAllPayoutsInCurrency(2017, 3, Currency.getInstance("EUR")).isEmpty());
    }

    @Test
    public void overlappingTransportsCountSharedDaysOnce() {
        Employee employee = EmployeeSupplier.getSampleEmployee();
        Payout payout = serviceFor(employee, scenario("overlapping")).getPayout(employee, 2017, 1);
        // Dec 28 -> Jan 24 inclusive; the Jan 8 and Jan 16-17 overlaps are not double counted.
        Assertions.assertEquals(28, payout.getWorkDays());
        Assertions.assertEquals(1400, payout.getAmount());
    }

    @Test
    public void currencyConversionUsesExchangeServiceWithoutNetwork() {
        Employee employee = EmployeeSupplier.getSampleEmployee();
        List<Pair<Employee, Payout>> huf = serviceFor(employee, scenario("past-month"))
                .getAllPayoutsInCurrency(2017, 4, Currency.getInstance("HUF"));
        Assertions.assertEquals(1, huf.size());
        Assertions.assertEquals(155000, huf.get(0).getSecond().getAmount());
        Assertions.assertEquals(Currency.getInstance("HUF"), huf.get(0).getSecond().getCurrency());
    }
}
