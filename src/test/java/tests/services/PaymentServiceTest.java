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
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import tests.supplier.EmployeeSupplier;
import tests.supplier.TransportSupplier;

import java.time.LocalDate;
import java.util.List;

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
}
