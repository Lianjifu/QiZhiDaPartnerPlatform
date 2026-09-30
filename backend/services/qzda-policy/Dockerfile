# Build from backend/ root:
#   docker build -f services/SERVICE/Dockerfile --build-arg CMD=SERVICE -t SERVICE:local .
ARG CMD=qzda-policy
FROM golang:1.24-alpine AS build
WORKDIR /src
RUN apk add --no-cache git ca-certificates
COPY go.mod go.sum ./
RUN go mod download
COPY . .
ARG CMD
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/app ./cmd/${CMD}

FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata curl
WORKDIR /app
COPY --from=build /out/app /app/app
USER nobody
ENTRYPOINT ["/app/app"]
