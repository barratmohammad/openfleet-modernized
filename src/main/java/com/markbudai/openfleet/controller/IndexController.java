package com.markbudai.openfleet.controller;


import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.RequestMapping;

import java.security.Principal;

/**
 * Created by Mark on 2017. 04. 14..
 */
@Controller
public class IndexController {

    private static Logger logger = LoggerFactory.getLogger(IndexController.class);

    /**
     * The FleetOS Command Center (static single-page UI under /app) is the default landing page.
     * @return a redirect to the Command Center.
     */
    @RequestMapping("/")
    public String commandCenter() {
        return "redirect:/app/index.html";
    }

    /**
     * The legacy server-rendered dashboard, kept available as the "Classic" view.
     */
    @RequestMapping("/classic")
    public String index(Model model, Principal principal) {
        model.addAttribute("path","/");
        model.addAttribute("title","Dashboard");
        model.addAttribute("username",principal.getName());
        logger.trace("Serving Index page.");
        return "index";
    }
}