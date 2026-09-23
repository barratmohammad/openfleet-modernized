package tests.configuration;

import com.markbudai.openfleet.configuration.WebSecurityConfig;
import org.junit.Assert;
import org.junit.Test;
import org.springframework.security.ldap.DefaultSpringSecurityContextSource;

import java.util.Arrays;

/**
 * Verifies that WebSecurityConfig builds its LDAP context source from configured values
 * instead of hardcoded deployment literals.
 */
public class WebSecurityConfigPropertiesTest {

    private WebSecurityConfig configWith(String urls) {
        return new WebSecurityConfig(urls, "dc=fixture,dc=test", "uid={0},ou=people", "ou=groups", "userPassword");
    }

    @Test
    public void contextSourceUsesConfiguredUrlAndBaseDn() {
        DefaultSpringSecurityContextSource source = configWith("ldap://ldap-a.test.invalid:389/").contextSource();
        Assert.assertEquals("dc=fixture,dc=test", source.getBaseLdapPathAsString());
        Assert.assertEquals(1, source.getUrls().length);
        Assert.assertTrue(source.getUrls()[0].startsWith("ldap://ldap-a.test.invalid:389"));
    }

    @Test
    public void contextSourceSupportsCommaSeparatedUrlList() {
        DefaultSpringSecurityContextSource source =
                configWith("ldap://ldap-a.test.invalid:389/, ldap://ldap-b.test.invalid:389/").contextSource();
        Assert.assertEquals(2, source.getUrls().length);
        Assert.assertTrue(Arrays.stream(source.getUrls()).anyMatch(u -> u.startsWith("ldap://ldap-b.test.invalid:389")));
    }

    @Test(expected = IllegalArgumentException.class)
    public void blankUrlListIsRejected() {
        configWith(" , ");
    }

    @Test
    public void contextSourceDoesNotFallBackToLegacyLocalhostDirectory() {
        DefaultSpringSecurityContextSource source = configWith("ldap://ldap-a.test.invalid:389/").contextSource();
        Assert.assertFalse(source.getUrls()[0].contains("localhost:8389"));
        Assert.assertNotEquals("dc=openfleet,dc=org", source.getBaseLdapPathAsString());
    }
}
