/*
 * Copyright (c) 2016 Daniel Garcia <danigm@wadobo.com>
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
 * Author: Daniel Garcia <danigm@wadobo.com>
 *
 */

const GLib = imports.gi.GLib;
const Gdk = imports.gi.Gdk;
const Gtk = imports.gi.Gtk;
const WebKit2 = imports.gi.WebKit2;
const _ = imports.gettext.gettext;

const Lang = imports.lang;

const Application = imports.application;
const ErrorBox = imports.errorBox;
const MainToolbar = imports.mainToolbar;
const Documents = imports.documents;

const Mainloop = imports.mainloop;
const Signals = imports.signals;
const Tweener = imports.tweener.tweener;

const Gepub = imports.gi.Gepub;
const Gio = imports.gi.Gio;

const EPUBView = new Lang.Class({
    Name: 'EPUBView',
    Extends: Gtk.Stack,

    _init: function(overlay) {
        this.parent({ homogeneous: true,
                      transition_type: Gtk.StackTransitionType.CROSSFADE });

        this._uri = null;
        this._overlay = overlay;
        this.get_style_context().add_class('documents-scrolledwin');
        this.page = 1;

        this._errorBox = new ErrorBox.ErrorBox();
        this.add_named(this._errorBox, 'error');

        this._sw = new Gtk.ScrolledWindow({hexpand: true,
                                           vexpand: true});

        this.add_named(this._sw, 'view');
        this._createView();

        // create context menu
        let model = this._getPreviewContextMenu();
        this._previewContextMenu = Gtk.Menu.new_from_model(model);
        this._previewContextMenu.attach_to_widget(this._sw, null);

        this.show_all();

        Application.documentManager.connect('load-started',
                                            Lang.bind(this, this._onLoadStarted));
        Application.documentManager.connect('load-error',
                                            Lang.bind(this, this._onLoadError));
    },

    _onLoadStarted: function(manager, doc) {
        if (doc.viewType != Documents.ViewType.EPUB)
            return;

        let docuri = doc.uri.slice(7).replace(/%20/g, ' ');
        this._doc = doc;
        this._epubdoc = Gepub.Doc.new(docuri);

        this._epubResources = [];
        for (var i in this._epubdoc.get_resources()) {
            this._epubResources.push(i);
        }
        this._epubSpine = this._epubdoc.get_spine();

        this._load_current();
        this.set_visible_child_name('view');
    },

    _onLoadError: function(manager, doc, message, exception) {
        if (doc.viewType != Documents.ViewType.EPUB)
            return;
        this._setError(message, exception.message);
    },

    _replaceResource: function(doc, tag, attr) {
        var ret2 = GLib.strdup(doc);
        var rex = new RegExp(attr+'\s*=\s*"([^"]*)"', "ig");
        var match = rex.exec(doc);
        while(match) {
            // removing relative path
            var path = match[1].replace(/^(\.*\/)/, '');
            var data = this._epubdoc.get_resource_v(path);
            var mime = this._epubdoc.get_resource_mime(path);
            var data2 = "data:" + mime + ";base64," + GLib.base64_encode(data);
            ret2 = ret2.replace(match[1], data2);
            match = rex.exec(doc);
        }

        return ret2;
    },

    replaceResources: function(current) {
        // resources as base64 to avoid path search

        let ret = current;
        // css
        ret = this._replaceResource(ret, "link", "href");
        // images
        ret = this._replaceResource(ret, "img", "src");
        // svg images
        ret = this._replaceResource(ret, "image", "xlink:href");

        return ret;
    },

    reset: function () {
        if (!this.view)
            return;

        this.set_visible_child_full('view', Gtk.StackTransitionType.NONE);
        this._copy.enabled = false;
        this.page = 1;
    },

    _createView: function() {
        this.view = new WebKit2.WebView();
        this._sw.add(this.view);
        this.view.show();

        this._navControls = new EPUBViewNavControls(this, this._overlay);
        this.set_visible_child_full('view', Gtk.StackTransitionType.NONE);
    },

    _getPreviewContextMenu: function() {
        let builder = new Gtk.Builder();
        builder.add_from_resource('/org/gnome/Documents/ui/preview-context-menu.ui');
        return builder.get_object('preview-context-menu');
    },

    _setError: function(primary, secondary) {
        this._errorBox.update(primary, secondary);
        this.set_visible_child_name('error');
    },

    go_next: function() {
        this._epubdoc.go_next();
        if (this.page < this._epubSpine.length) {
            this.page++;
            this._load_current();
        }
    },

    go_prev: function() {
        this._epubdoc.go_prev();
        if (this.page > 1) {
            this.page--;
            this._load_current();
        }
    },

    _load_current: function() {
        let current = this._epubdoc.get_current();
        current = this.replaceResources(String(current));
        this.view.load_html(current, null, null, null);
    },
});

const EPUBViewToolbar = new Lang.Class({
    Name: 'EPUBViewToolbar',
    Extends: MainToolbar.MainToolbar,

    _init: function(previewView) {
        this._previewView = previewView;

        this.parent();
        this.toolbar.set_show_close_button(true);

        this._handleEvent = false;
        this._model = null;

        this._searchAction = Application.application.lookup_action('search');
        this._searchAction.enabled = false;

        this._gearMenu = Application.application.lookup_action('gear-menu');
        this._gearMenu.enabled = true;

        // back button, on the left of the toolbar
        let backButton = this.addBackButton();
        backButton.connect('clicked', Lang.bind(this,
            function() {
                Application.documentManager.setActiveItem(null);
                Application.modeController.goBack();
                this._searchAction.enabled = true;
            }));

        // menu button, on the right of the toolbar
        let previewMenu = this._getPreviewMenu();
        let menuButton = new Gtk.MenuButton({ image: new Gtk.Image ({ icon_name: 'open-menu-symbolic' }),
                                              menu_model: previewMenu,
                                              action_name: 'app.gear-menu' });
        this.toolbar.pack_end(menuButton);

        // search button, on the right of the toolbar
        this.addSearchButton();

        this._setToolbarTitle();
        this.toolbar.show_all();

        this.connect('destroy', Lang.bind(this,
            function() {
                this._searchAction.enabled = true;
            }));
    },

    _getPreviewMenu: function() {
        let builder = new Gtk.Builder();
        builder.add_from_resource('/org/gnome/Documents/ui/preview-menu.ui');
        let menu = builder.get_object('preview-menu');
        let section = builder.get_object('open-section');

        section.remove(0);
        // No edit support yet
        section.remove(0);
        // No print support yet
        section.remove(0);
        // No present support yet
        section.remove(0);

        // No rotate support
        section = builder.get_object('rotate-section');
        section.remove(0);
        section.remove(0);

        return menu;

    },

    _setToolbarTitle: function() {
        let primary = null;
        let doc = Application.documentManager.getActiveItem();

        if (doc)
            primary = doc.name;

        this.toolbar.set_title(primary);
    },
});

const _PREVIEW_NAVBAR_MARGIN = 30;
const _AUTO_HIDE_TIMEOUT = 2;

const EPUBViewNavControls = new Lang.Class({
    Name: 'EPUBViewNavControls',

    _init: function(epubView, overlay) {
        this._epubView = epubView;
        this._overlay = overlay;

        this._visible = false;
        this._visibleInternal = false;
        this._pageChangedId = 0;
        this._autoHideId = 0;
        this._motionId = 0;

        this.prev_widget = new Gtk.Button({ image: new Gtk.Image ({ icon_name: 'go-previous-symbolic',
                                                                    pixel_size: 16 }),
                                            margin: _PREVIEW_NAVBAR_MARGIN,
                                            halign: Gtk.Align.START,
                                            valign: Gtk.Align.CENTER });
        this.prev_widget.get_style_context().add_class('osd');
        this._overlay.add_overlay(this.prev_widget);
        this.prev_widget.connect('clicked', Lang.bind(this, this._onPrevClicked));
        this.prev_widget.connect('enter-notify-event', Lang.bind(this, this._onEnterNotify));
        this.prev_widget.connect('leave-notify-event', Lang.bind(this, this._onLeaveNotify));

        this.next_widget = new Gtk.Button({ image: new Gtk.Image ({ icon_name: 'go-next-symbolic',
                                                                    pixel_size: 16 }),
                                            margin: _PREVIEW_NAVBAR_MARGIN,
                                            halign: Gtk.Align.END,
                                            valign: Gtk.Align.CENTER });
        this.next_widget.get_style_context().add_class('osd');
        this._overlay.add_overlay(this.next_widget);
        this.next_widget.connect('clicked', Lang.bind(this, this._onNextClicked));
        this.next_widget.connect('enter-notify-event', Lang.bind(this, this._onEnterNotify));
        this.next_widget.connect('leave-notify-event', Lang.bind(this, this._onLeaveNotify));
        this._overlay.connect('motion-notify-event', Lang.bind(this, this._onMotion));
        this._visible = true;

    },

    _onEnterNotify: function() {
        this._unqueueAutoHide();
        return false;
    },

    _onLeaveNotify: function() {
        this._queueAutoHide();
        return false;
    },

    _motionTimeout: function() {
        this._motionId = 0;
        this._visibleInternal = true;
        this._updateVisibility();
        this._queueAutoHide();
        return false;
    },

    _onMotion: function(widget, event) {
        if (this._motionId != 0) {
            return false;
        }

        let device = event.get_source_device();
        if (device.input_source == Gdk.InputSource.TOUCHSCREEN) {
            return false;
        }

        this._motionId = Mainloop.idle_add(Lang.bind(this, this._motionTimeout));
        return false;
    },

    _onPrevClicked: function() {
        this._epubView.go_prev();
    },

    _onNextClicked: function() {
        this._epubView.go_next();
    },

    _autoHide: function() {
        this._autoHideId = 0;
        this._visibleInternal = false;
        this._updateVisibility();
        return false;
    },

    _unqueueAutoHide: function() {
        if (this._autoHideId == 0)
            return;

        Mainloop.source_remove(this._autoHideId);
        this._autoHideId = 0;
    },

    _queueAutoHide: function() {
        this._unqueueAutoHide();
        this._autoHideId = Mainloop.timeout_add_seconds(_AUTO_HIDE_TIMEOUT, Lang.bind(this, this._autoHide));
    },

    _updateVisibility: function() {
        if (!this._epubView) {
            return;
        }

        if (!this._visible || !this._visibleInternal) {
            this._fadeOutButton(this.prev_widget);
            this._fadeOutButton(this.next_widget);
            return;
        }

        if (this._epubView.page == 1) {
            this._fadeOutButton(this.prev_widget);
        } else {
            this._fadeInButton(this.prev_widget);
        }

        var l = this._epubView._epubSpine.length;
        if (this._epubView.page >= l) {
            this._fadeOutButton(this.next_widget);
        } else {
            this._fadeInButton(this.next_widget);
        }
    },

    _fadeInButton: function(widget) {
        widget.show_all();
        Tweener.addTween(widget, { opacity: 1,
                                   time: 0.30,
                                   transition: 'easeOutQuad' });
    },

    _fadeOutButton: function(widget) {
        Tweener.addTween(widget, { opacity: 0,
                                   time: 0.30,
                                   transition: 'easeOutQuad',
                                   onComplete: function() {
                                       widget.hide();
                                   },
                                   onCompleteScope: this });
    },

    show: function() {
        this._visible = true;
        this._visibleInternal = true;
        this._updateVisibility();
        this._queueAutoHide();
    },

    hide: function() {
        this._visible = false;
        this._visibleInternal = false;
        this._updateVisibility();
    },

    destroy: function() {
        this.prev_widget.destroy();
        this.next_widget.destroy();
    }
});
