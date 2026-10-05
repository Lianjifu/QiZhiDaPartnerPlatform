package infra

import (
	"context"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/redis/go-redis/v9"
)

// OpenRedis connects to Docker Compose Redis via QZDA_REDIS_URL.
// Returns nil client when URL is empty.
func OpenRedis(ctx context.Context) (*redis.Client, error) {
	url := os.Getenv("QZDA_REDIS_URL")
	if url == "" {
		return nil, nil
	}
	opt, err := redis.ParseURL(url)
	if err != nil {
		return nil, fmt.Errorf("parse QZDA_REDIS_URL: %w", err)
	}
	client := redis.NewClient(opt)

	var last error
	for i := 0; i < 30; i++ {
		last = client.Ping(ctx).Err()
		if last == nil {
			log.Printf("redis connected (%s)", url)
			return client, nil
		}
		time.Sleep(500 * time.Millisecond)
	}
	_ = client.Close()
	return nil, fmt.Errorf("redis not ready after retries: %w", last)
}
