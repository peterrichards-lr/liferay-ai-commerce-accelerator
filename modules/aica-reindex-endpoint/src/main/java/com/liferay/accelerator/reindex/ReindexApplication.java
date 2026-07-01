package com.liferay.accelerator.reindex;

import java.util.Collections;
import java.util.Set;

import jakarta.ws.rs.core.Application;

import org.osgi.service.component.annotations.Component;
import org.osgi.service.jaxrs.whiteboard.JaxrsWhiteboardConstants;

@Component(
	property = {
		JaxrsWhiteboardConstants.JAX_RS_APPLICATION_BASE + "=/aica-reindex",
		JaxrsWhiteboardConstants.JAX_RS_NAME + "=AICA.Reindex",
		"auth.verifier.guest.allowed=false",
		"liferay.access.control.disable=false"
	},
	service = Application.class
)
public class ReindexApplication extends Application {

	@Override
	public Set<Object> getSingletons() {
		return Collections.singleton(new ReindexResource());
	}

}
