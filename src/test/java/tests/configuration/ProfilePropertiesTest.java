package tests.configuration;

import org.junit.Assert;
import org.junit.BeforeClass;
import org.junit.Test;
import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.support.PropertiesLoaderUtils;

import java.io.IOException;
import java.util.Properties;
import java.util.regex.Pattern;

/**
 * Verifies the dev/prod split of OpenFleet configuration: the shared file is
 * profile-neutral, dev carries local conveniences, prod carries only placeholders.
 */
public class ProfilePropertiesTest {

    private static final Pattern PLACEHOLDER_WITHOUT_DEFAULT = Pattern.compile("^\\$\\{[A-Z_]+\\}$");

    private static Properties shared;
    private static Properties dev;
    private static Properties prod;

    @BeforeClass
    public static void load() throws IOException {
        shared = PropertiesLoaderUtils.loadProperties(new ClassPathResource("application.properties"));
        dev = PropertiesLoaderUtils.loadProperties(new ClassPathResource("application-dev.properties"));
        prod = PropertiesLoaderUtils.loadProperties(new ClassPathResource("application-prod.properties"));
    }

    @Test
    public void sharedFileHasNoEmbeddedLdapOrDatasourceLocation() {
        Assert.assertFalse(shared.stringPropertyNames().stream().anyMatch(k -> k.startsWith("spring.ldap.embedded.")));
        Assert.assertNull(shared.getProperty("spring.datasource.url"));
        Assert.assertNull(shared.getProperty("spring.datasource.username"));
        Assert.assertNull(shared.getProperty("spring.datasource.password"));
        Assert.assertNull(shared.getProperty("openfleet.ldap.urls"));
    }

    @Test
    public void sharedFileDoesNotActivateAProfile() {
        Assert.assertNull(shared.getProperty("spring.profiles.active"));
    }

    @Test
    public void devProfileUsesEmbeddedLdapFixture() {
        Assert.assertEquals("classpath:test-server.ldif", dev.getProperty("spring.ldap.embedded.ldif"));
        Assert.assertEquals("dc=openfleet,dc=org", dev.getProperty("spring.ldap.embedded.base-dn"));
    }

    @Test
    public void devProfileDatasourceIsOverridableAndNotLegacyRoot() {
        Assert.assertTrue(dev.getProperty("spring.datasource.url").startsWith("${OPENFLEET_DATASOURCE_URL:"));
        Assert.assertFalse(dev.getProperty("spring.datasource.username").contains("root"));
    }

    @Test
    public void prodProfileHasNoEmbeddedLdap() {
        Assert.assertFalse(prod.stringPropertyNames().stream().anyMatch(k -> k.startsWith("spring.ldap.embedded.")));
    }

    @Test
    public void prodProfileSecretsArePlaceholdersWithoutFallbacks() {
        for (String key : new String[]{"spring.datasource.url", "spring.datasource.username",
                "spring.datasource.password", "openfleet.ldap.urls", "openfleet.ldap.base-dn"}) {
            String value = prod.getProperty(key);
            Assert.assertNotNull(key + " must be defined in the prod profile", value);
            Assert.assertTrue(key + " must be a placeholder without a default but was " + value,
                    PLACEHOLDER_WITHOUT_DEFAULT.matcher(value).matches());
        }
    }
}
