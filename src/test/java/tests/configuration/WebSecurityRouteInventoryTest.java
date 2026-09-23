package tests.configuration;

import com.markbudai.openfleet.controller.ApiController;
import com.markbudai.openfleet.controller.EmployeeController;
import com.markbudai.openfleet.controller.IndexController;
import com.markbudai.openfleet.controller.LocationController;
import com.markbudai.openfleet.controller.LoginController;
import com.markbudai.openfleet.controller.TractorController;
import com.markbudai.openfleet.controller.TrailerController;
import com.markbudai.openfleet.controller.TransportController;
import org.junit.AfterClass;
import org.junit.Assert;
import org.junit.BeforeClass;
import org.junit.Test;
import org.springframework.core.annotation.AnnotatedElementUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.context.support.AnnotationConfigWebApplicationContext;

import java.lang.reflect.Method;
import java.util.Arrays;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;
import java.util.stream.Collectors;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/**
 * Executable inventory of every controller route and how the security boundary treats it.
 * This is the baseline later CSRF and RBAC work is measured against.
 */
public class WebSecurityRouteInventoryTest {

    enum Access { PUBLIC, AUTHENTICATED }

    static final class Route {
        final String method;
        final String path;
        final Access access;

        Route(String method, String path, Access access) {
            this.method = method;
            this.path = path;
            this.access = access;
        }
    }

    private static Route get_(String path) { return new Route("GET", path, Access.AUTHENTICATED); }
    private static Route post_(String path) { return new Route("POST", path, Access.AUTHENTICATED); }

    /** Every mapping declared in the controller package. Keep in sync; inventoryMatchesControllerMappings enforces it. */
    static final List<Route> INVENTORY = Arrays.asList(
            new Route("GET", "/login", Access.PUBLIC),
            get_("/"),
            // Employees and payroll
            get_("/employee/list"), get_("/employee/new"), post_("/employee/add"), get_("/employee/edit"),
            get_("/employee/delete"), get_("/employee/payment"), get_("/employee/payouts"),
            // Locations
            get_("/locations/list"), get_("/locations/new"), post_("/locations/add"), get_("/locations/edit"),
            get_("/locations/delete"),
            // Tractors
            get_("/tractors/list"), get_("/tractor"), get_("/tractor/delete"), post_("/tractor/add"), get_("/tractor/new"),
            // Trailers
            get_("/trailers/list"), get_("/trailer"), get_("/trailer/delete"), post_("/trailer/add"), get_("/trailer/new"),
            // Transport jobs and costs
            get_("/transport/jobs/list"), get_("/transport/new"), get_("/transport/edit"), post_("/transport/job/add"),
            get_("/transport/job"), post_("/transport/job/addCost"), get_("/transport/job/deleteCost"),
            get_("/transports/api"),
            // JSON API
            get_("/api/tractors"), get_("/api/badges"), get_("/api/trailers"), get_("/api/employees"),
            get_("/api/locations"), get_("/api/employeePerformance")
    );

    static final List<String> STATIC_ASSETS = Arrays.asList(
            "/css/style.css", "/js/validators.js", "/fonts/example.woff", "/img/example.png", "/bower_components/example.js");

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

    private static MockHttpServletRequestBuilder request(Route route) {
        MockHttpServletRequestBuilder builder = "POST".equals(route.method)
                ? post(route.path).with(csrf())
                : get(route.path);
        // Supplies the id parameters that detail, edit and delete routes require.
        return builder.param("id", "1").param("transportId", "1");
    }

    @Test
    public void inventoryMatchesControllerMappings() {
        Set<String> declared = new TreeSet<>();
        for (Class<?> controller : Arrays.asList(ApiController.class, EmployeeController.class, IndexController.class,
                LocationController.class, LoginController.class, TractorController.class, TrailerController.class,
                TransportController.class)) {
            RequestMapping classMapping = AnnotatedElementUtils.findMergedAnnotation(controller, RequestMapping.class);
            String prefix = classMapping != null && classMapping.value().length > 0 ? classMapping.value()[0] : "";
            for (Method method : controller.getDeclaredMethods()) {
                RequestMapping mapping = AnnotatedElementUtils.findMergedAnnotation(method, RequestMapping.class);
                if (mapping != null) {
                    for (String path : mapping.value()) {
                        declared.add(prefix + path);
                    }
                }
            }
        }
        Set<String> inventoried = INVENTORY.stream().map(r -> r.path).collect(Collectors.toCollection(TreeSet::new));
        Assert.assertEquals("Route inventory drifted from controller mappings", declared, inventoried);
        Assert.assertEquals("Each route must appear once", INVENTORY.size(), inventoried.size());
        Assert.assertEquals(38, INVENTORY.size());
    }

    @Test
    public void loginPageIsPublic() throws Exception {
        MvcResult result = mvc.perform(get("/login")).andReturn();
        Assert.assertEquals(200, result.getResponse().getStatus());
        Assert.assertEquals("/WEB-INF/test-views/login.html", result.getResponse().getForwardedUrl());
    }

    @Test
    public void staticAssetsAreNotBehindLogin() throws Exception {
        for (String asset : STATIC_ASSETS) {
            MvcResult result = mvc.perform(get(asset)).andReturn();
            Assert.assertNull(asset + " must not redirect to login", result.getResponse().getRedirectedUrl());
            Assert.assertNotEquals(asset + " must not be forbidden", 403, result.getResponse().getStatus());
        }
    }

    @Test
    public void everyProtectedRouteRedirectsAnonymousUsersToLogin() throws Exception {
        for (Route route : INVENTORY) {
            if (route.access != Access.AUTHENTICATED) {
                continue;
            }
            MvcResult result = mvc.perform(request(route)).andReturn();
            Assert.assertEquals(route.method + " " + route.path + " status", 302, result.getResponse().getStatus());
            Assert.assertEquals(route.method + " " + route.path + " redirect",
                    "http://localhost/login", result.getResponse().getRedirectedUrl());
        }
    }

    @Test
    public void keyRoutesHaveExpectedAnonymousOutcome() throws Exception {
        for (String path : Arrays.asList("/employee/list", "/api/tractors", "/tractor/new", "/transport/jobs/list")) {
            Assert.assertEquals(path, "http://localhost/login",
                    mvc.perform(get(path)).andReturn().getResponse().getRedirectedUrl());
        }
        for (String path : Arrays.asList("/employee/add", "/transport/job/addCost")) {
            Assert.assertEquals(path, "http://localhost/login",
                    mvc.perform(post(path).with(csrf())).andReturn().getResponse().getRedirectedUrl());
        }
    }

    @Test
    public void authenticatedUserReachesEmployeeList() throws Exception {
        MvcResult result = mvc.perform(get("/employee/list").with(user("admin"))).andReturn();
        Assert.assertEquals(200, result.getResponse().getStatus());
        Assert.assertEquals("/WEB-INF/test-views/employee/listEmployees.html", result.getResponse().getForwardedUrl());
    }
}
