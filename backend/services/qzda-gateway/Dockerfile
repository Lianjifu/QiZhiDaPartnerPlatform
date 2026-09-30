# docker build -f services/qzda-gateway/Dockerfile -t qzda-gateway:local .
FROM envoyproxy/envoy:v1.31-latest
COPY deploy/envoy/envoy.coarse.yaml /etc/envoy/envoy.yaml
EXPOSE 8089 9901
CMD ["envoy", "-c", "/etc/envoy/envoy.yaml", "--log-level", "info"]
