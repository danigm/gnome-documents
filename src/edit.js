/*
 * Copyright (c) 2013, 2014, 2015 Red Hat, Inc.
 *
 * Gnome Documents is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by the
 * Free Software Foundation; either version 2 of the License, or (at your
 * option) any later version.
 *
 * Gnome Documents is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
 * or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU General Public License
 * for more details.
 *
 * You should have received a copy of the GNU General Public License along
 * with Gnome Documents; if not, write to the Free Software Foundation,
 * Inc., 51 Franklin St, Fifth Floor, Boston, MA  02110-1301  USA
 *
 */

const WebKit = imports.gi.WebKit2;
const GLib = imports.gi.GLib;
const Gtk = imports.gi.Gtk;
const _ = imports.gettext.gettext;

const Lang = imports.lang;
const Mainloop = imports.mainloop;

const Application = imports.application;
const MainToolbar = imports.mainToolbar;
const WindowMode = imports.windowMode;

const _BLANK_URI = "about:blank";

const EditView = new Lang.Class({
    Name: 'EditView',
    Extends: Gtk.Overlay,

    _init: function() {
        this._uri = null;

        this.parent();
        this.get_style_context().add_class('documents-scrolledwin');

        let context = WebKit.WebContext.get_default();

        let cacheDir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'gnome-documents', 'webkit']);
        context.set_disk_cache_directory(cacheDir);

        let cookie_manager = context.get_cookie_manager();
        let jarfile = GLib.build_filenamev([GLib.get_user_cache_dir(), 'gnome-documents', 'cookies.sqlite']);
        cookie_manager.set_persistent_storage(jarfile, WebKit.CookiePersistentStorage.SQLITE);

        this._progressBar = new Gtk.ProgressBar({ halign: Gtk.Align.FILL,
                                                  valign: Gtk.Align.START });
        this._progressBar.get_style_context().add_class('osd');
        this.add_overlay(this._progressBar);

        this._createView();

        this.show_all();

        this._editAction = Application.application.lookup_action('edit-current');
        this._editAction.enabled = false;
        this._editAction.connect('activate', Lang.bind(this,
            function() {
                let doc = Application.documentManager.getActiveItem();
                if (!doc)
                    return;
                Application.modeController.setWindowMode(WindowMode.WindowMode.EDIT);
                this.setUri (doc.uri);
            }));

        this._viewAction = Application.application.lookup_action('view-current');
        this._viewAction.enabled = false;
        this._viewAction.connect('activate', Lang.bind(this,
            function() {
                Application.modeController.goBack();
            }));

        this._printAction = Application.application.lookup_action('print-current');
        this._printAction.set_enabled(false);

        Application.documentManager.connect('load-started',
                                            Lang.bind(this, this._onLoadStarted));
        Application.documentManager.connect('load-finished',
                                            Lang.bind(this, this._onLoadFinished));

    },

    _onLoadStarted: function() {
        this._editAction.enabled = false;
        this._viewAction.enabled = false;
        this._printAction.set_enabled(false);
    },

    _onLoadFinished: function(manager, doc, docModel) {
        if (doc.uri) {
            if (doc.canEdit())
                this._editAction.enabled = true;
            this._viewAction.enabled = true;
            if (doc.canPrint(docModel))
                this._printAction.set_enabled(true);
        }
    },

    _createView: function() {
        this.view = new WebKit.WebView();
        this.add(this.view);
        this.view.show();
        this.view.connect('notify::estimated-load-progress', Lang.bind(this, this._onProgressChanged));
    },

    _onProgressChanged: function() {
        if (!this.view.uri || this.view.uri == _BLANK_URI)
            return;

        let progress = this.view.estimated_load_progress;
        let loading = this.view.is_loading;

        if (progress == 1.0 || !loading) {
            if (!this._timeoutId)
                this._timeoutId = Mainloop.timeout_add(500, Lang.bind(this, this._onTimeoutExpired));
        } else {
            if (this._timeoutId) {
                Mainloop.source_remove(this._timeoutId);
                this._timeoutId = 0;
            }
            this._progressBar.show();
        }
        let value = 0.0
        if (loading || progress == 1.0)
            value = progress;
        this._progressBar.fraction = value;
    },

    _onTimeoutExpired: function() {
        this._timeoutId = 0;
        this._progressBar.hide();
        return false;
    },

    setUri: function(uri) {
        if (this._uri == uri)
            return;

        if (!uri)
            uri = _BLANK_URI;

        this._uri = uri;
        this.view.load_uri (uri);
    },

    getUri: function() {
        return this._uri;
    },
});

const EditToolbar = new Lang.Class({
    Name: 'EditToolbar',
    Extends: MainToolbar.MainToolbar,

    _init: function(editView) {
        this._editView = editView;

        this.parent();
        this.toolbar.set_show_close_button(true);

        // back button, on the left of the toolbar
        let backButton = this.addBackButton();
        backButton.connect('clicked', Lang.bind(this,
            function() {
                Application.documentManager.setActiveItem(null);
                Application.modeController.goBack(2);
            }));

        let viewButton = new Gtk.Button({ label: _("View"),
                                          action_name: 'app.view-current' });
        viewButton.get_style_context().add_class('suggested-action');
        this.toolbar.pack_end(viewButton);

        this._setToolbarTitle();
        this.show_all();
    },

    createSearchbar: function() {
    },

    handleEvent: function(event) {
        return false;
    },

    _setToolbarTitle: function() {
        let primary = null;
        let doc = Application.documentManager.getActiveItem();

        if (doc)
            primary = doc.name;

        this.toolbar.set_title(primary);
    }
});
