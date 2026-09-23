package tests.templates;

import org.junit.Assert;
import org.junit.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/**
 * Inspects Thymeleaf templates so every state-changing form submits the Spring Security CSRF token.
 */
public class ThymeleafCsrfTemplateTest {

    private static final Path TEMPLATES = Paths.get("src/main/resources/templates");
    private static final String TOKEN_INPUT = "th:name=\"${_csrf.parameterName}\" th:value=\"${_csrf.token}\"";
    private static final Pattern POST_FORM = Pattern.compile("<form[^>]*method=\"post\"[^>]*>(.*?)</form>",
            Pattern.DOTALL | Pattern.CASE_INSENSITIVE);

    private static String read(String relative) throws IOException {
        return new String(Files.readAllBytes(TEMPLATES.resolve(relative)), StandardCharsets.UTF_8);
    }

    /** Returns the body of each POST form in the template. */
    private static List<String> postForms(String html) {
        List<String> forms = new ArrayList<>();
        Matcher matcher = POST_FORM.matcher(html);
        while (matcher.find()) {
            forms.add(matcher.group(0));
        }
        return forms;
    }

    private static boolean carriesToken(String form) {
        // Either an explicit hidden input, or th:action which Spring Security's
        // CsrfRequestDataValueProcessor uses to emit the token automatically.
        return form.contains(TOKEN_INPUT) || form.contains("th:action=");
    }

    @Test
    public void costManagementAddCostFormHasCsrfInput() throws IOException {
        List<String> forms = postForms(read("transport/costManagement.html"));
        Assert.assertFalse(forms.isEmpty());
        Assert.assertTrue(forms.stream().anyMatch(f -> f.contains("/transport/job/addCost") && f.contains(TOKEN_INPUT)));
    }

    @Test
    public void employeeFormPostingToEmployeeAddHasCsrfInput() throws IOException {
        List<String> forms = postForms(read("employee/employeeDetails.html"));
        Assert.assertTrue(forms.stream().anyMatch(f -> f.contains("@{/employee/add}") && f.contains(TOKEN_INPUT)));
    }

    @Test
    public void transportJobAndCostFormsHaveCsrfInput() throws IOException {
        Assert.assertTrue(postForms(read("transport/newTransport.html")).stream()
                .anyMatch(f -> f.contains("/transport/job/add") && f.contains(TOKEN_INPUT)));
        Assert.assertTrue(postForms(read("transport/transportDetails.html")).stream()
                .anyMatch(f -> f.contains("/transport/job/addCost") && f.contains(TOKEN_INPUT)));
    }

    @Test
    public void everyPostFormInEveryTemplateCarriesToken() throws IOException {
        List<String> missing = new ArrayList<>();
        try (Stream<Path> files = Files.walk(TEMPLATES)) {
            for (Path file : files.filter(p -> p.toString().endsWith(".html")).collect(Collectors.toList())) {
                String html = new String(Files.readAllBytes(file), StandardCharsets.UTF_8);
                for (String form : postForms(html)) {
                    if (!carriesToken(form)) {
                        missing.add(TEMPLATES.relativize(file).toString());
                    }
                }
            }
        }
        Assert.assertTrue("POST forms without CSRF token: " + missing, missing.isEmpty());
    }
}
