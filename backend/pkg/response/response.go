package response

import (
	"encoding/json"
	"net/http"
	"reflect"

	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

// API envelope matching frontend ApiClient expectations.
type Envelope struct {
	OK    bool       `json:"ok"`
	Data  any        `json:"data,omitempty"`
	Error *ErrorBody `json:"error,omitempty"`
}

type ErrorBody struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func JSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// normalizeNilSlice 将 nil slice 转为空 slice，避免 JSON 输出 null 导致前端 .filter/.map 崩溃。
func normalizeNilSlice(data any) any {
	if data == nil {
		return data
	}
	v := reflect.ValueOf(data)
	if v.Kind() == reflect.Slice && v.IsNil() {
		return reflect.MakeSlice(v.Type(), 0, 0).Interface()
	}
	return data
}

func OK(w http.ResponseWriter, data any) {
	JSON(w, http.StatusOK, Envelope{OK: true, Data: normalizeNilSlice(data)})
}

func Created(w http.ResponseWriter, data any) {
	JSON(w, http.StatusCreated, Envelope{OK: true, Data: normalizeNilSlice(data)})
}

func Fail(w http.ResponseWriter, err error) {
	if ae, ok := err.(*apperr.AppError); ok {
		JSON(w, ae.Status, Envelope{OK: false, Error: &ErrorBody{Code: string(ae.Code), Message: ae.Message}})
		return
	}
	JSON(w, http.StatusInternalServerError, Envelope{OK: false, Error: &ErrorBody{Code: string(apperr.Unknown), Message: err.Error()}})
}

func Decode(r *http.Request, dst any) error {
	defer r.Body.Close()
	dec := json.NewDecoder(r.Body)
	dec.UseNumber()
	return dec.Decode(dst)
}
