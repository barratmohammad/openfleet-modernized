package tests.configuration;

import com.markbudai.openfleet.framework.builder.EmployeeBuilder;
import com.markbudai.openfleet.model.Employee;
import com.markbudai.openfleet.model.Transport;
import com.markbudai.openfleet.services.TransportService;
import com.markbudai.openfleet.services.EmployeeService;
import org.junit.AfterClass;
import org.junit.Assert;
import org.junit.Before;
import org.junit.BeforeClass;
import org.junit.Test;
import org.mockito.ArgumentMatchers;
import org.mockito.Mockito;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.web.context.request.WebRequest;
import org.springframework.web.context.support.AnnotationConfigWebApplicationContext;

import java.util.Arrays;
import java.util.Collections;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/**
 * Verifies CSRF enforcement on state-changing form routes through the real security filter chain.
 */
public class WebSecurityCsrfIntegrationTest {

    private static AnnotationConfigWebApplicationContext context;
    private static MockMvc mvc;

    @BeforeClass
    public static void start() throws Exception {
        context = SecurityWebTestContext.createContext();
        mvc = SecurityWebTestContext.mockMvc(context);
    }

    @AfterClass
    public static void stop() {
        context.close();
    }

    @Before
    public void resetMocks() {
        Mockito.reset(context.getBean(EmployeeService.class), context.getBean(EmployeeBuilder.class),
                context.getBean(TransportService.class));
    }

    @Test
    public void postsWithoutTokenAreRejectedEvenForAuthenticatedUsers() throws Exception {
        for (String path : Arrays.asList("/employee/add", "/transport/job/add", "/transport/job/addCost")) {
            MvcResult result = mvc.perform(post(path).with(user("admin"))).andReturn();
            Assert.assertEquals(path + " without CSRF token", 403, result.getResponse().getStatus());
        }
    }

    @Test
    public void postsWithInvalidTokenAreRejected() throws Exception {
        MvcResult result = mvc.perform(post("/employee/add").with(user("admin")).with(csrf().useInvalidToken())).andReturn();
        Assert.assertEquals(403, result.getResponse().getStatus());
    }

    @Test
    public void validTokenReachesEmployeeSubmit() throws Exception {
        EmployeeBuilder builder = context.getBean(EmployeeBuilder.class);
        EmployeeService employeeService = context.getBean(EmployeeService.class);
        Employee newEmployee = new Employee();
        Mockito.when(builder.buildFromWebRequest(ArgumentMatchers.any(WebRequest.class))).thenReturn(newEmployee);
        Mockito.when(employeeService.getAllEmployees()).thenReturn(Collections.<Employee>emptyList());

        MvcResult result = mvc.perform(post("/employee/add").with(user("admin")).with(csrf())
                .param("firstName", "Anna")).andReturn();

        Assert.assertEquals(200, result.getResponse().getStatus());
        Assert.assertEquals("/WEB-INF/test-views/employee/listEmployees.html", result.getResponse().getForwardedUrl());
        Mockito.verify(employeeService).addEmployee(newEmployee);
    }

    @Test
    public void loginPageAndStaticAssetsStillReachable() throws Exception {
        Assert.assertEquals(200, mvc.perform(get("/login")).andReturn().getResponse().getStatus());
        Assert.assertNull(mvc.perform(get("/css/style.css")).andReturn().getResponse().getRedirectedUrl());
    }

    @Test
    public void safeGetRoutesAreUnaffectedByCsrf() throws Exception {
        Mockito.when(context.getBean(EmployeeService.class).getAllEmployees()).thenReturn(Collections.<Employee>emptyList());
        Assert.assertEquals(200, mvc.perform(get("/employee/list").with(user("admin"))).andReturn().getResponse().getStatus());
    }

    @Test
    public void transportCostFlowWithValidTokenReachesAddCost() throws Exception {
        TransportService transportService = context.getBean(TransportService.class);
        Transport transport = Mockito.mock(Transport.class);
        Mockito.when(transportService.getTransportById(7L)).thenReturn(transport);

        MvcResult result = mvc.perform(post("/transport/job/addCost").with(user("admin")).with(csrf())
                .param("transportId", "7").param("amount", "120").param("costDescription", "Diesel")
                .param("currency", "EUR").param("date", "2026-09-01")).andReturn();

        Assert.assertNotEquals(403, result.getResponse().getStatus());
        Assert.assertEquals("/WEB-INF/test-views/transport/transportDetails.html", result.getResponse().getForwardedUrl());
        Mockito.verify(transport).addCost(ArgumentMatchers.any());
        Mockito.verify(transportService).updateTransport(transport);
    }
}
