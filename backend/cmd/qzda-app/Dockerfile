# syntax=docker/dockerfile:1.6
# qzda-app monolith image: sys + collab + cap + workflow in a single binary.
# Optional in-process Temporal worker (QZDA_WORKFLOW_WORKER=1, QZDA_TEMPORAL_HOST=...).

FROM golang:1.23-bookworm AS builder

WORKDIR /src
COPY backend/go.mod backend/go.sum ./
RUN go mod download

COPY backend/ ./
ARG CMD=qzda-app
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -trimpath -ldflags="-s -w" -o /out/app ./cmd/${CMD}

FROM gcr.io/distroless/static-debian12:nonroot

WORKDIR /app
COPY --from=builder /out/app /app/qzda-app

USER nonroot:nonroot

ENV QZDA_APP_ADDR=:8100 \
    QZDA_SERVICE=app

EXPOSE 8100

ENTRYPOINT ["/app/qzda-app"]
