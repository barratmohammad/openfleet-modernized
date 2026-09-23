package tests.configuration;

import org.junit.Assert;
import org.junit.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;

/**
 * Guards against CSRF protection being switched off again in WebSecurityConfig.
 */
public class WebSecurityCsrfConfigTest {

    private static final String CONFIG_SOURCE =
            "src/main/java/com/markbudai/openfleet/configuration/WebSecurityConfig.java";

    @Test
    public void webSecurityConfigDoesNotDisableCsrf() throws IOException {
        String source = new String(Files.readAllBytes(Paths.get(CONFIG_SOURCE)), StandardCharsets.UTF_8);
        Assert.assertFalse("WebSecurityConfig must not disable CSRF", source.replaceAll("\\s", "").contains("csrf().disable()"));
    }
}
