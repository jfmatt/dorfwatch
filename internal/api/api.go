// Package api exposes the tile catalog and campaign saves over HTTP.
package api

import (
	"encoding/json"
	"errors"
	"io/fs"
	"log"
	"net/http"
	"strings"

	"dorfwatch/internal/store"
	"dorfwatch/internal/tiles"
)

// Server wires the catalog, the save store and the static web assets together.
type Server struct {
	catalog *tiles.Catalog
	store   *store.Store
	web     http.Handler
}

// New builds the HTTP handler tree. webFS is served at the root.
func New(catalog *tiles.Catalog, st *store.Store, webFS fs.FS) *Server {
	return &Server{
		catalog: catalog,
		store:   st,
		web:     http.FileServer(http.FS(webFS)),
	}
}

// Handler returns the mux serving both the API and the web app.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/catalog", s.getCatalog)
	mux.HandleFunc("GET /api/campaigns", s.listCampaigns)
	mux.HandleFunc("POST /api/campaigns", s.createCampaign)
	mux.HandleFunc("GET /api/campaigns/{id}", s.getCampaign)
	mux.HandleFunc("PUT /api/campaigns/{id}", s.saveCampaign)
	mux.HandleFunc("DELETE /api/campaigns/{id}", s.deleteCampaign)

	mux.HandleFunc("/", s.serveWeb)
	return logRequests(mux)
}

func (s *Server) serveWeb(w http.ResponseWriter, r *http.Request) {
	// Anything under /api that reached here is a route that does not exist;
	// answering with JSON beats serving index.html to a fetch call.
	if strings.HasPrefix(r.URL.Path, "/api/") {
		writeError(w, http.StatusNotFound, "no such endpoint")
		return
	}
	// The app is a single page; unknown paths fall back to it.
	if r.URL.Path != "/" && !strings.Contains(strings.TrimPrefix(r.URL.Path, "/"), ".") {
		r = r.Clone(r.Context())
		r.URL.Path = "/"
	}
	s.web.ServeHTTP(w, r)
}

func (s *Server) getCatalog(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.catalog)
}

func (s *Server) listCampaigns(w http.ResponseWriter, r *http.Request) {
	list, err := s.store.List()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, list)
}

func (s *Server) createCampaign(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name string `json:"name"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	c, err := s.store.Create(body.Name)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, c)
}

func (s *Server) getCampaign(w http.ResponseWriter, r *http.Request) {
	c, err := s.store.Get(r.PathValue("id"))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, c)
}

func (s *Server) saveCampaign(w http.ResponseWriter, r *http.Request) {
	var c store.Campaign
	if err := decodeJSON(w, r, &c); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	saved, err := s.store.Save(r.PathValue("id"), &c)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, saved)
}

func (s *Server) deleteCampaign(w http.ResponseWriter, r *http.Request) {
	if err := s.store.Delete(r.PathValue("id")); err != nil {
		writeStoreError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func decodeJSON(w http.ResponseWriter, r *http.Request, v any) error {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<20))
	dec.DisallowUnknownFields()
	return dec.Decode(v)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("write response: %v", err)
	}
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func writeStoreError(w http.ResponseWriter, err error) {
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "campaign not found")
		return
	}
	writeError(w, http.StatusInternalServerError, err.Error())
}

func logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			log.Printf("%s %s", r.Method, r.URL.Path)
		}
		next.ServeHTTP(w, r)
	})
}
