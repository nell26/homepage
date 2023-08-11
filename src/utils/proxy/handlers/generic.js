import getServiceWidget from "utils/config/service-helpers";
import { formatApiCall, sanitizeErrorURL } from "utils/proxy/api-helpers";
import validateWidgetData from "utils/proxy/validate-widget-data";
import { httpProxy } from "utils/proxy/http";
import createLogger from "utils/logger";
import widgets from "widgets/widgets";
import {importCookieHeader} from "utils/proxy/cookie-jar";

const logger = createLogger("genericProxyHandler");

export default async function genericProxyHandler(req, res, map) {
  const { group, service, endpoint } = req.query;

  if (group && service) {
    const widget = await getServiceWidget(group, service);

    if (!widgets?.[widget.type]?.api) {
      return res.status(403).json({ error: "Service does not support API calls" });
    }

    if (widget) {
      const url = new URL(formatApiCall(widgets[widget.type].api, { endpoint, ...widget }));

      let headers;
      if (widget.username && widget.password) {
        headers = {
          Authorization: `Basic ${Buffer.from(`${widget.username}:${widget.password}`).toString("base64")}`,
        };
      }

      const params = {
        method: req.method,
        headers,
      }
      if (req.body) {
        params.body = req.body;
      }

      if (req.headers.cookie) {
          importCookieHeader(url, req.headers.cookie)
      }

      const [status, contentType, data] = await httpProxy(url, params);

      let resultData = data;

      if (resultData.error?.url) {
        resultData.error.url = sanitizeErrorURL(url);
      }

      if (status === 200) {
        if (!validateWidgetData(widget, endpoint, resultData)) {
          return res.status(status).json({error: {message: "Invalid data", url: sanitizeErrorURL(url), data: resultData}});
        }
        if (map) resultData = map(resultData);
      }

      if (contentType) res.setHeader("Content-Type", contentType);

      if (status === 204 || status === 304) {
        return res.status(status).end();
      }

      if (status >= 400) {
        logger.debug(
          "HTTP Error %d calling %s//%s%s%s...",
          status,
          url.protocol,
          url.hostname,
          url.port ? `:${url.port}` : '',
          url.pathname
        );
        return res.status(status).json({error: {message: "HTTP Error", url: sanitizeErrorURL(url), resultData}});
      }

      return res.status(status).send(resultData);
    }
  }

  logger.debug("Invalid or missing proxy service type '%s' in group '%s'", service, group);
  return res.status(400).json({ error: "Invalid proxy service type" });
}
