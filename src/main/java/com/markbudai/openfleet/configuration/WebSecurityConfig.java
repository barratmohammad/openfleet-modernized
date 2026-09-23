package com.markbudai.openfleet.configuration;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.authentication.encoding.LdapShaPasswordEncoder;
import org.springframework.security.config.annotation.authentication.builders.AuthenticationManagerBuilder;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.annotation.web.configuration.WebSecurityConfigurerAdapter;
import org.springframework.security.ldap.DefaultSpringSecurityContextSource;

import java.util.Arrays;
import java.util.List;
import java.util.stream.Collectors;

/**
 * This class represents a configuration bean for ldap authentication.
 * All LDAP deployment values are resolved from externalized configuration
 * (openfleet.ldap.* properties, usually fed by OPENFLEET_LDAP_* environment variables)
 * so no environment-specific directory address is committed in source.
 */
@Configuration
@EnableWebSecurity
public class WebSecurityConfig extends WebSecurityConfigurerAdapter{

    private final List<String> ldapUrls;
    private final String ldapBaseDn;
    private final String userDnPattern;
    private final String groupSearchBase;
    private final String passwordAttribute;

    /**
     * Creates the security configuration from externalized LDAP settings.
     * @param ldapUrls comma separated LDAP server URLs.
     * @param ldapBaseDn the base DN of the directory.
     * @param userDnPattern the DN pattern used to locate a user, relative to the base DN.
     * @param groupSearchBase the search base for group membership, relative to the base DN.
     * @param passwordAttribute the attribute holding the user's password hash.
     */
    public WebSecurityConfig(@Value("${openfleet.ldap.urls}") String ldapUrls,
                             @Value("${openfleet.ldap.base-dn}") String ldapBaseDn,
                             @Value("${openfleet.ldap.user-dn-pattern}") String userDnPattern,
                             @Value("${openfleet.ldap.group-search-base}") String groupSearchBase,
                             @Value("${openfleet.ldap.password-attribute}") String passwordAttribute) {
        this.ldapUrls = Arrays.stream(ldapUrls.split(","))
                .map(String::trim)
                .filter(url -> !url.isEmpty())
                .collect(Collectors.toList());
        if (this.ldapUrls.isEmpty()) {
            throw new IllegalArgumentException("openfleet.ldap.urls must contain at least one LDAP URL (set OPENFLEET_LDAP_URLS).");
        }
        this.ldapBaseDn = ldapBaseDn;
        this.userDnPattern = userDnPattern;
        this.groupSearchBase = groupSearchBase;
        this.passwordAttribute = passwordAttribute;
    }

    @Override
    protected void configure(HttpSecurity http) throws Exception {
        // CSRF protection stays at Spring Security's default (enabled): every POST/PUT/DELETE
        // must carry the session's CSRF token, which Thymeleaf th:action forms emit automatically.
        http
                .authorizeRequests()
                    .antMatchers("/css/**","/js/**","/fonts/**","/img/**","/bower_components/**","/transport.png","/favicon.ico").permitAll()
                    .anyRequest().fullyAuthenticated()
                    .and()
                .formLogin()
                    .loginPage("/login")
                    .permitAll()
                    .and()
                .logout()
                    .permitAll();
    }

    /**
     * Configures the {@link org.springframework.security.config.annotation.authentication.builders.AuthenticationManagerBuilder} for LDAP authentication.
     * @param auth the {@link org.springframework.security.config.annotation.authentication.builders.AuthenticationManagerBuilder} used to configure LDAP authenticaton.
     * @throws Exception if an error occurs when adding the LDAP authentication.
     */
    @Autowired
    public void configureGlobal(AuthenticationManagerBuilder auth) throws Exception{
        auth
                .ldapAuthentication()
                    .userDnPatterns(userDnPattern)
                    .groupSearchBase(groupSearchBase)
                    .contextSource(contextSource())
                    .passwordCompare()
                        .passwordEncoder(new LdapShaPasswordEncoder())
                        .passwordAttribute(passwordAttribute);
     }

    /**
     * Provides a {@link org.springframework.security.ldap.DefaultSpringSecurityContextSource} for LDAP authenticaton.
     * @return a new {@link org.springframework.security.ldap.DefaultSpringSecurityContextSource} built from the configured LDAP URLs and base DN.
     */
    @Bean
    public DefaultSpringSecurityContextSource contextSource(){
        return new DefaultSpringSecurityContextSource(ldapUrls, ldapBaseDn);
    }
}
