package com.example.aichat.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.MDC;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class MdcFilter extends OncePerRequestFilter {

    private static final Pattern SESSION_PATTERN = Pattern.compile("/api/chat/([^/]+)");

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {
        MDC.put("requestId", UUID.randomUUID().toString().substring(0, 8));

        String path = request.getRequestURI();
        Matcher matcher = SESSION_PATTERN.matcher(path);
        if (matcher.find()) {
            String segment = matcher.group(1);
            if (!"start".equals(segment)) {
                MDC.put("sessionId", segment);
            }
        }

        response.setHeader("X-Content-Type-Options", "nosniff");
        response.setHeader("X-Frame-Options", "DENY");
        response.setHeader("Cache-Control", "no-store");

        try {
            filterChain.doFilter(request, response);
        } finally {
            MDC.clear();
        }
    }
}
