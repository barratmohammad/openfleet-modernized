package tests.configuration;

import com.markbudai.openfleet.configuration.WebSecurityConfig;
import org.junit.After;
import org.junit.Assert;
import org.junit.Before;
import org.junit.Test;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.support.PropertySourcesPlaceholderConfigurer;
import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.support.ResourcePropertySource;
import org.springframework.security.ldap.DefaultSpringSecurityContextSource;

/**
 * Boots a Spring context containing WebSecurityConfig with the externalized property fixture,
 * proving the bean is created purely from configuration.
 */
public class ConfigurationExternalizationIntegrationTest {

    private AnnotationConfigApplicationContext context;

    @Configuration
    static class PlaceholderConfig {
        @Bean
        public static PropertySourcesPlaceholderConfigurer placeholderConfigurer() {
            return new PropertySourcesPlaceholderConfigurer();
        }
    }

    @Before
    public void startContext() throws Exception {
        context = new AnnotationConfigApplicationContext();
        context.getEnvironment().getPropertySources().addFirst(
                new ResourcePropertySource(new ClassPathResource("config/externalized-ldap-datasource.properties")));
        context.register(PlaceholderConfig.class, WebSecurityConfig.class);
        context.refresh();
    }

    @After
    public void closeContext() {
        if (context != null) {
            context.close();
        }
    }

    @Test
    public void webSecurityConfigBeanIsCreatedFromFixture() {
        Assert.assertNotNull(context.getBean(WebSecurityConfig.class));
    }

    @Test
    public void contextSourceBeanReflectsFixtureValues() {
        DefaultSpringSecurityContextSource source = context.getBean(DefaultSpringSecurityContextSource.class);
        Assert.assertEquals("dc=fixture,dc=test", source.getBaseLdapPathAsString());
        Assert.assertEquals(2, source.getUrls().length);
    }

    @Test
    public void datasourceFixtureValuesAreResolvableAndNotLegacyDefaults() {
        Assert.assertEquals("openfleet_fixture_user", context.getEnvironment().getProperty("spring.datasource.username"));
        Assert.assertNotEquals("root", context.getEnvironment().getProperty("spring.datasource.username"));
        Assert.assertNotEquals("password", context.getEnvironment().getProperty("spring.datasource.password"));
    }
}
