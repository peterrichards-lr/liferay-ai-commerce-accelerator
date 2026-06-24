package com.liferay.accelerator.reindex;

import com.liferay.portal.kernel.security.auth.PrincipalException;
import com.liferay.portal.kernel.security.permission.PermissionChecker;
import com.liferay.portal.kernel.security.permission.PermissionThreadLocal;
import com.liferay.portal.kernel.search.IndexWriterHelperUtil;
import com.liferay.portal.kernel.util.PortalUtil;

import javax.ws.rs.POST;
import javax.ws.rs.Path;
import javax.ws.rs.PathParam;
import javax.ws.rs.Produces;
import javax.ws.rs.core.MediaType;
import javax.ws.rs.core.Response;

public class ReindexResource {

	@POST
	@Path("/reindex/all")
	@Produces(MediaType.APPLICATION_JSON)
	public Response reindexAll() {
		try {
			_checkPermission();

			long[] companyIds = PortalUtil.getCompanyIds();
			for (long companyId : companyIds) {
				IndexWriterHelperUtil.reindex(0, "reindex", new long[]{companyId}, null);
			}

			return Response.ok("{\"status\":\"success\", \"message\":\"All indexes scheduled for reindexing\"}").build();
		}
		catch (PrincipalException e) {
			return Response.status(Response.Status.FORBIDDEN)
				.entity("{\"status\":\"error\", \"message\":\"" + e.getMessage() + "\"}")
				.build();
		}
		catch (Exception e) {
			return Response.status(Response.Status.INTERNAL_SERVER_ERROR)
				.entity("{\"status\":\"error\", \"message\":\"" + e.getMessage() + "\"}")
				.build();
		}
	}

	@POST
	@Path("/reindex/{className}")
	@Produces(MediaType.APPLICATION_JSON)
	public Response reindexClass(@PathParam("className") String className) {
		try {
			_checkPermission();

			long[] companyIds = PortalUtil.getCompanyIds();
			for (long companyId : companyIds) {
				IndexWriterHelperUtil.reindex(0, className, new long[]{companyId}, null);
			}

			return Response.ok("{\"status\":\"success\", \"className\":\"" + className + "\", \"message\":\"Reindex scheduled for " + className + "\"}").build();
		}
		catch (PrincipalException e) {
			return Response.status(Response.Status.FORBIDDEN)
				.entity("{\"status\":\"error\", \"message\":\"" + e.getMessage() + "\"}")
				.build();
		}
		catch (Exception e) {
			return Response.status(Response.Status.INTERNAL_SERVER_ERROR)
				.entity("{\"status\":\"error\", \"message\":\"" + e.getMessage() + "\"}")
				.build();
		}
	}

	private void _checkPermission() throws PrincipalException {
		PermissionChecker permissionChecker = PermissionThreadLocal.getPermissionChecker();

		if (permissionChecker == null || !permissionChecker.isOmniadmin()) {
			throw new PrincipalException.MustBeOmniadmin();
		}
	}

}
