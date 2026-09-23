package tests.configuration;

import com.markbudai.openfleet.configuration.WebSecurityConfig;
import com.markbudai.openfleet.controller.ApiController;
import com.markbudai.openfleet.controller.EmployeeController;
import com.markbudai.openfleet.controller.IndexController;
import com.markbudai.openfleet.controller.LocationController;
import com.markbudai.openfleet.controller.LoginController;
import com.markbudai.openfleet.controller.TractorController;
import com.markbudai.openfleet.controller.TrailerController;
import com.markbudai.openfleet.controller.TransportController;
import com.markbudai.openfleet.framework.builder.EmployeeBuilder;
import com.markbudai.openfleet.framework.builder.TransportBuilder;
import com.markbudai.openfleet.services.EmployeeService;
import com.markbudai.openfleet.services.LocationService;
import com.markbudai.openfleet.services.PaymentService;
import com.markbudai.openfleet.services.TractorService;
import com.markbudai.openfleet.services.TrailerService;
import com.markbudai.openfleet.services.TransferCostService;
import com.markbudai.openfleet.services.TransportService;
import org.mockito.Mockito;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.context.support.PropertySourcesPlaceholderConfigurer;
import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.support.ResourcePropertySource;
import org.springframework.mock.web.MockServletContext;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.support.AnnotationConfigWebApplicationContext;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;
import org.springframework.web.servlet.view.InternalResourceViewResolver;

import java.io.IOException;

import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;

/**
 * Builds a web context with the real WebSecurityConfig and real controllers, backed by
 * Mockito service mocks. No database, LDAP server or Thymeleaf rendering is needed:
 * views resolve to non-existent forward paths so only the security and MVC boundary is exercised.
 */
final class SecurityWebTestContext {

    private SecurityWebTestContext() {
    }

    @Configuration
    @EnableWebMvc
    @Import({WebSecurityConfig.class, ApiController.class, EmployeeController.class, IndexController.class,
            LocationController.class, LoginController.class, TractorController.class, TrailerController.class,
            TransportController.class})
    static class WebConfig {
        @Bean
        public static PropertySourcesPlaceholderConfigurer placeholderConfigurer() {
            return new PropertySourcesPlaceholderConfigurer();
        }

        @Bean
        public InternalResourceViewResolver viewResolver() {
            // A prefix keeps view names like "login" from forwarding back to /login (circular view path).
            return new InternalResourceViewResolver("/WEB-INF/test-views/", ".html");
        }

        @Bean public TractorService tractorService() { return Mockito.mock(TractorService.class); }
        @Bean public TrailerService trailerService() { return Mockito.mock(TrailerService.class); }
        @Bean public EmployeeService employeeService() { return Mockito.mock(EmployeeService.class); }
        @Bean public LocationService locationService() { return Mockito.mock(LocationService.class); }
        @Bean public TransportService transportService() { return Mockito.mock(TransportService.class); }
        @Bean public PaymentService paymentService() { return Mockito.mock(PaymentService.class); }
        @Bean public TransferCostService transferCostService() { return Mockito.mock(TransferCostService.class); }
        @Bean public EmployeeBuilder employeeBuilder() { return Mockito.mock(EmployeeBuilder.class); }
        @Bean public TransportBuilder transportBuilder() { return Mockito.mock(TransportBuilder.class); }
    }

    static AnnotationConfigWebApplicationContext createContext() throws IOException {
        AnnotationConfigWebApplicationContext context = new AnnotationConfigWebApplicationContext();
        context.setServletContext(new MockServletContext());
        context.getEnvironment().getPropertySources().addFirst(
                new ResourcePropertySource(new ClassPathResource("config/externalized-ldap-datasource.properties")));
        context.register(WebConfig.class);
        context.refresh();
        return context;
    }

    static MockMvc mockMvc(AnnotationConfigWebApplicationContext context) {
        return MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    }
}
