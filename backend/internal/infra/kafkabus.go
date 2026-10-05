package infra

import (
	"context"
	"encoding/json"
	"log"
	"os"
	"strings"
	"time"

	"github.com/segmentio/kafka-go"
)

// KafkaAuditBus publishes audit events to Kafka/Redpanda (optional).
type KafkaAuditBus struct {
	writer *kafka.Writer
	topic  string
}

func NewKafkaAuditBusFromEnv() *KafkaAuditBus {
	brokers := strings.TrimSpace(os.Getenv("QZDA_KAFKA_BROKERS"))
	if brokers == "" {
		return nil
	}
	topic := envOr("QZDA_KAFKA_AUDIT_TOPIC", "de.audit.v1")
	return &KafkaAuditBus{
		topic: topic,
		writer: &kafka.Writer{
			Addr:         kafka.TCP(strings.Split(brokers, ",")...),
			Topic:        topic,
			Balancer:     &kafka.LeastBytes{},
			RequiredAcks: kafka.RequireOne,
			Async:        true,
			BatchTimeout: 50 * time.Millisecond,
		},
	}
}

func (k *KafkaAuditBus) Close() error {
	if k == nil || k.writer == nil {
		return nil
	}
	return k.writer.Close()
}

func (k *KafkaAuditBus) Publish(ctx context.Context, ev map[string]any) {
	if k == nil || k.writer == nil {
		return
	}
	payload, err := json.Marshal(ev)
	if err != nil {
		return
	}
	key := str(ev["correlationId"])
	if key == "" {
		key = str(ev["id"])
	}
	if err := k.writer.WriteMessages(ctx, kafka.Message{
		Key:   []byte(key),
		Value: payload,
		Time:  time.Now().UTC(),
	}); err != nil {
		log.Printf("kafka audit publish failed: %v", err)
	}
}

func envOr(k, d string) string {
	if v := strings.TrimSpace(os.Getenv(k)); v != "" {
		return v
	}
	return d
}
