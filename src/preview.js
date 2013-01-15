/*
 * Copyright (c) 2011 Red Hat, Inc.
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
 * Author: Cosimo Cecchi <cosimoc@redhat.com>
 *
 */

const Clutter = imports.gi.Clutter;
const EvView = imports.gi.EvinceView;
const GdPrivate = imports.gi.GdPrivate;
const Gdk = imports.gi.Gdk;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Gtk = imports.gi.Gtk;
const GtkClutter = imports.gi.GtkClutter;
const _ = imports.gettext.gettext;

const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Signals = imports.signals;

const Application = imports.application;
const Tweener = imports.util.tweener;
const MainToolbar = imports.mainToolbar;
const Places = imports.places;
const Searchbar = imports.searchbar;
const Utils = imports.utils;
const View = imports.view;

const _FULLSCREEN_TOOLBAR_TIMEOUT = 2; // seconds

const PreviewView = new Lang.Class({
    Name: 'PreviewView',

    _init: function(overlayLayout) {
        this._model = null;
        this._jobFind = null;
        this._controlsFlipId = 0;
        this._controlsVisible = false;
        this._pageChanged = false;
        this._viewSelectionChanged = false;
        this._fsToolbar = null;
        this._overlayLayout = overlayLayout;

        Application.modeController.connect('fullscreen-changed',
            Lang.bind(this, this._onFullscreenChanged));

        this.widget = new Gtk.ScrolledWindow({ hexpand: true,
                                               vexpand: true,
                                               shadow_type: Gtk.ShadowType.IN });
        this.widget.get_style_context().add_class('documents-scrolledwin');
        this.widget.get_hscrollbar().connect('button-press-event', Lang.bind(this, this._onScrollbarClick));
        this.widget.get_vscrollbar().connect('button-press-event', Lang.bind(this, this._onScrollbarClick));
        this.widget.get_hadjustment().connect('value-changed', Lang.bind(this, this._onAdjustmentChanged));
        this.widget.get_vadjustment().connect('value-changed', Lang.bind(this, this._onAdjustmentChanged));

        this._createView();

        // create page nav bar
        this._navBar = new PreviewNav(this._model);
        this._overlayLayout.add(this._navBar.actor,
            Clutter.BinAlignment.FILL, Clutter.BinAlignment.END);

        this.widget.show_all();

        this._zoomIn = Application.application.lookup_action('zoom-in');
        this._zoomIn.connect('activate', Lang.bind(this,
            function() {
                this._model.set_sizing_mode(EvView.SizingMode.FREE);
                this.view.zoom_in();
            }));

        this._zoomOut = Application.application.lookup_action('zoom-out');
        this._zoomOut.connect('activate', Lang.bind(this,
            function() {
                this._model.set_sizing_mode(EvView.SizingMode.FREE);
                this.view.zoom_out();
            }));

        this._findPrev = Application.application.lookup_action('find-prev');
        this._findPrev.connect('activate', Lang.bind(this,
            function() {
                this.view.find_previous();
            }));
        this._findNext = Application.application.lookup_action('find-next');
        this._findNext.connect('activate', Lang.bind(this,
            function() {
                this.view.find_next();
            }));

        let rotLeft = Application.application.lookup_action('rotate-left');
        rotLeft.connect('activate', Lang.bind(this,
            function() {
                this._changeRotation(-90);
            }));
        let rotRight = Application.application.lookup_action('rotate-right');
        rotRight.connect('activate', Lang.bind(this,
            function() {
                this._changeRotation(90);
            }));
        let showPlaces = Application.application.lookup_action('places');
        showPlaces.connect('activate', Lang.bind(this, this._showPlaces));
    },

    _showPlaces: function() {
        let dialog = new Places.PlacesDialog(this._model);
        dialog.widget.connect('response', Lang.bind(this,
            function(widget, response) {
                widget.destroy();
            }));
    },

    _onViewSelectionChanged: function() {
        this._viewSelectionChanged = true;
        if (!this.view.get_has_selection())
            this._cancelControlsFlip();
    },

    _onCanZoomInChanged: function() {
        this._zoomIn.enabled = this.view.can_zoom_in;
    },

    _onCanZoomOutChanged: function() {
        this._zoomOut.enabled = this.view.can_zoom_out;
    },

    _createView: function() {
        this.view = EvView.View.new();
        this.widget.add(this.view);
        this.view.show();

        this.view.connect('notify::can-zoom-in',
                          Lang.bind(this, this._onCanZoomInChanged));
        this.view.connect('notify::can-zoom-out',
                          Lang.bind(this, this._onCanZoomOutChanged));
        this.view.connect('button-press-event',
                            Lang.bind(this, this._onButtonPressEvent));
        this.view.connect('button-release-event',
                            Lang.bind(this, this._onButtonReleaseEvent));
        this.view.connect('key-press-event',
                            Lang.bind(this, this._onKeyPressEvent));
        this.view.connect('selection-changed',
                            Lang.bind(this, this._onViewSelectionChanged));
    },

    _syncControlsVisible: function() {
        if (this._controlsVisible) {
            if (this._fsToolbar)
                this._fsToolbar.show();
            this._navBar.show();
        } else {
            if (this._fsToolbar)
                this._fsToolbar.hide();
            this._navBar.hide();
        }
    },

    _onFullscreenChanged: function() {
        let fullscreen = Application.modeController.getFullscreen();

        if (fullscreen) {
            // create fullscreen toolbar (hidden by default)
            this._fsToolbar = new PreviewFullscreenToolbar(this);
            this._fsToolbar.setModel(this._model);
            this._overlayLayout.add(this._fsToolbar.actor,
                Clutter.BinAlignment.FILL, Clutter.BinAlignment.START);

            this._fsToolbar.connect('show-controls', Lang.bind(this,
                function() {
                    this.controlsVisible = true;
                }));
        } else {
            this._fsToolbar.actor.destroy();
            this._fsToolbar = null;
        }

        this._syncControlsVisible();
    },

    _onKeyPressEvent: function(widget, event) {
        let keyval = event.get_keyval()[1];
        let state = event.get_state()[1];

        if ((keyval == Gdk.KEY_Page_Up) &&
            ((state & Gdk.ModifierType.CONTROL_MASK) != 0)) {
            this.view.previous_page();
            return true;
        }

        if ((keyval == Gdk.KEY_Page_Down) &&
            ((state & Gdk.ModifierType.CONTROL_MASK) != 0)) {
            this.view.next_page();
            return true;
        }

        if (keyval == Gdk.KEY_Page_Up) {
            this.view.scroll(Gtk.ScrollType.PAGE_BACKWARD, false);
            return true;
        }

        if (keyval == Gdk.KEY_space ||
            keyval == Gdk.KEY_Page_Down) {
            this.view.scroll(Gtk.ScrollType.PAGE_FORWARD, false);
            return true;
        }

        return false;
     },

    _flipControlsTimeout: function() {
        this._controlsFlipId = 0;
        let visible = this.controlsVisible;
        this.controlsVisible = !visible;

        return false;
    },

     _cancelControlsFlip: function() {
         if (this._controlsFlipId != 0) {
             Mainloop.source_remove(this._controlsFlipId);
             this._controlsFlipId = 0;
         }
     },

     _queueControlsFlip: function() {
         if (this._controlsFlipId)
             return;

         let settings = Gtk.Settings.get_default();
         let doubleClick = settings.gtk_double_click_time;

         this._controlsFlipId = Mainloop.timeout_add(doubleClick, Lang.bind(this, this._flipControlsTimeout));
     },

    _onButtonPressEvent: function(widget, event) {

        this._viewSelectionChanged = false;

        return false;
   },

    _onButtonReleaseEvent: function(widget, event) {
        let button = event.get_button()[1];
        let clickCount = event.get_click_count()[1];

        if (button == 1
            && clickCount == 1
            && !this._viewSelectionChanged)
            this._queueControlsFlip();
        else
            this._cancelControlsFlip();

        this._viewSelectionChanged = false;

        return false;
    },

    _onScrollbarClick: function() {
        this.controlsVisible = false;
        return false;
    },

    _onAdjustmentChanged: function() {
        if (!this._pageChanged)
            this.controlsVisible = false;
        this._pageChanged = false;
    },

    _changeRotation: function(offset) {
        let rotation = this._model.get_rotation();
        this._model.set_rotation(rotation + offset);
    },

    get controlsVisible() {
        return this._controlsVisible;
    },

    set controlsVisible(visible) {
        // reset any pending timeout, as we're about to change controls state
        this._cancelControlsFlip();

        if (this._controlsVisible == visible)
            return;

        this._controlsVisible = visible;
        this._syncControlsVisible();
    },

    startSearch: function(str) {
        if (!this._model)
            return;

        if (this._jobFind) {
            if (!this._jobFind.is_finished())
                this._jobFind.cancel();
            this._jobFind = null;
        }

        if (!str) {
            this.view.queue_draw();
            return;
        }

        let evDoc = this._model.get_document();
        this._jobFind = EvView.JobFind.new(evDoc, this._model.get_page(), evDoc.get_n_pages(),
                                           str, false);
        this._jobFind.connect('updated', Lang.bind(this, this._onSearchJobUpdated));

        this._jobFind.scheduler_push_job(EvView.JobPriority.PRIORITY_NONE);
    },

    _onSearchJobUpdated: function(job, page) {
        // FIXME: ev_job_find_get_results() returns a GList **
        // and thus is not introspectable
        GdPrivate.ev_view_find_changed(this.view, job, page);
        this.emit('search-changed', job.has_results());
    },

    setModel: function(model) {
        if (this._model == model)
            return;

        if (this.view) {
            this.view.destroy();
            this.controlsVisible = false;
        }

        this._model = model;

        if (this._model) {
            this._createView();
            this.view.set_model(this._model);
            this._navBar.widget.document_model = model;
            this._model.connect('page-changed', Lang.bind(this,
                function() {
                    this._pageChanged = true;
                }));

        }
    },

    getModel: function() {
        return this._model;
    },

    getFullscreenToolbar: function() {
        return this._fsToolbar;
    }
});
Signals.addSignalMethods(PreviewView.prototype);

const PreviewNav = new Lang.Class({
    Name: 'PreviewNav',

    _init: function(model) {
        this.widget = new GdPrivate.NavBar({ document_model: model });
        this.widget.get_style_context().add_class('osd');

        let button = new Gtk.Button({ action_name: 'app.places',
                                      child: new Gtk.Image({ icon_name: 'view-list-symbolic',
                                                             pixel_size: 16 }),
                                      valign: Gtk.Align.CENTER
                                    });
        let button_area = this.widget.get_button_area();
        button_area.pack_start(button, false, false, 0);

        this.actor = new GtkClutter.Actor({ contents: this.widget,
                                            visible: false,
                                            opacity: 0 });
        Utils.alphaGtkWidget(this.actor.get_widget());

        this.widget.show_all();
    },

    show: function() {
        this.actor.show();

        Tweener.addTween(this.actor,
            { opacity: 255,
              time: 0.30,
              transition: 'easeOutQuad' });
    },

    hide: function() {
        Tweener.addTween(this.actor,
            { opacity: 0,
              time: 0.30,
              transition: 'easeOutQuad',
              onComplete: function() {
                  this.actor.hide();
              },
              onCompleteScope: this });
    }
});

const PreviewToolbar = new Lang.Class({
    Name: 'PreviewToolbar',
    Extends: MainToolbar.MainToolbar,

    _init: function(previewView) {
        this._previewView = previewView;

        this.parent();

        // back button, on the left of the toolbar
        let iconName =
            (this.widget.get_direction() == Gtk.TextDirection.RTL) ?
            'go-next-symbolic' : 'go-previous-symbolic';
        let backButton =
            this.widget.add_button(iconName, _("Back"), true);
        backButton.connect('clicked', Lang.bind(this,
            function() {
                Application.documentManager.setActiveItem(null);
            }));

        // search button, on the right of the toolbar
        this.addSearchButton();

        // menu button, on the right of the toolbar
        let previewMenu = this._getPreviewMenu();
        let menuButton = this.widget.add_menu('emblem-system-symbolic', null, false);
        menuButton.set_menu_model(previewMenu);
        menuButton.set_action_name('app.gear-menu');

        this._setToolbarTitle();
        this.widget.show_all();
    },

    _getPreviewMenu: function() {
        let builder = new Gtk.Builder();
        builder.add_from_resource('/org/gnome/documents/preview-menu.ui');
        let menu = builder.get_object('preview-menu');

        let doc = Application.documentManager.getActiveItem();
        if (doc && doc.defaultAppName) {
            let section = builder.get_object('open-section');
            section.remove(0);
            section.prepend(_("Open with %s").format(doc.defaultAppName), 'app.open-current');
        }

        return menu;
    },

    createSearchbar: function() {
        this._searchbar = new PreviewSearchbar(this._previewView);
        this.layout.pack_start = false;
        this.layout.pack(this._searchbar.actor, false, true, false,
                         Clutter.BoxAlignment.CENTER, Clutter.BoxAlignment.START);
    },

    _setToolbarTitle: function() {
        let primary = null;
        let doc = Application.documentManager.getActiveItem();

        if (doc)
            primary = doc.name;

        this.widget.set_labels(primary, null);
    },

    setModel: function(model) {
        if (!model)
            return;

        this._model = model;
        this._setToolbarTitle();
    }
});

const PreviewSearchbar = new Lang.Class({
    Name: 'PreviewSearchbar',
    Extends: Searchbar.Searchbar,

    _init: function(previewView) {
        this._previewView = previewView;
        this._previewView.connect('search-changed', Lang.bind(this, this._onSearchChanged));
        this._lastText = '';

        this.parent();
    },

    createSearchWidgets: function() {
        this._searchContainer = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL,
                                              spacing: 6,
                                              halign: Gtk.Align.CENTER});

        this._searchEntry = new Gtk.SearchEntry({ width_request: 500 });
        this._searchEntry.connect('activate', Lang.bind(this,
            function() {
                Application.application.activate_action('find-next', null);
            }));
        this._searchContainer.add(this._searchEntry);

        let controlsBox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL });
        controlsBox.get_style_context().add_class('linked');
        controlsBox.get_style_context().add_class('raised');
        this._searchContainer.add(controlsBox);

        this._prev = new Gtk.Button({ action_name: 'app.find-prev' });
        this._prev.set_image(new Gtk.Image({ icon_name: 'go-up-symbolic',
                                             icon_size: Gtk.IconSize.MENU,
                                             margin: 2 }));
        this._prev.set_tooltip_text(_("Find Previous"));
        controlsBox.add(this._prev);

        this._next = new Gtk.Button({ action_name: 'app.find-next' });
        this._next.set_image(new Gtk.Image({ icon_name: 'go-down-symbolic',
                                             icon_size: Gtk.IconSize.MENU,
                                             margin: 2 }));
        this._next.set_tooltip_text(_("Find Next"));
        controlsBox.add(this._next);

        this._onSearchChanged(this._previewView, false);
    },

    _onSearchChanged: function(view, hasResults) {
        let findPrev = Application.application.lookup_action('find-prev');
        let findNext = Application.application.lookup_action('find-next');
        findPrev.enabled = hasResults;
        findNext.enabled = hasResults;
    },

    entryChanged: function() {
        this._previewView.view.find_search_changed();
        this._previewView.startSearch(this._searchEntry.get_text());
    },

    show: function() {
        this.parent();

        if (!this._searchEntry.get_text()) {
            this._searchEntry.set_text(this._lastText);
            this._searchEntry.select_region(0, -1);
        }

        this._lastText = '';
        this._previewView.view.find_set_highlight_search(true);
        this._previewView.startSearch(this._searchEntry.get_text());
    },

    hide: function() {
        this._previewView.view.find_set_highlight_search(false);
        this._lastText = this._searchEntry.get_text();

        this.parent();
    }
});

const PreviewFullscreenToolbar = new Lang.Class({
    Name: 'PreviewFullscreenToolbar',
    Extends: PreviewToolbar,

    _init: function(previewView) {
        this.parent(previewView);

        this.actor.translation_y = -(this.widget.get_preferred_height()[1]);

        // make controls show when a toolbar action is activated in fullscreen
        let actionNames = ['gear-menu', 'search'];
        let signalIds = [];

        actionNames.forEach(Lang.bind(this,
            function(actionName) {
                let signalName = 'action-state-changed::' + actionName;
                let signalId = Application.application.connect(signalName, Lang.bind(this,
                    function(actionGroup, actionName, value) {
                        let state = value.get_boolean();
                        if (state)
                            this.emit('show-controls');
                    }));

                signalIds.push(signalId);
            }));

        this.widget.connect('destroy', Lang.bind(this,
            function() {
                signalIds.forEach(
                    function(signalId) {
                        Application.application.disconnect(signalId);
                    });
            }));
    },

    handleEvent: function(event) {
        let res = this.parent(event);
        if (res)
            this.emit('search-event-handled');
    },

    show: function() {
        this.actor.show();
        Tweener.addTween(this.actor,
                         { translation_y: 0,
                           time: 0.20,
                           transition: 'easeInQuad' });
    },

    hide: function() {
        Tweener.addTween(this.actor,
                         { translation_y: -(this.widget.get_preferred_height()[1]),
                           time: 0.20,
                           transition: 'easeOutQuad',
                           onComplete: Lang.bind(this,
                               function() {
                                   this.actor.hide();
                                   Application.application.change_action_state('search', GLib.Variant.new('b', false));
                               })
                         });
    }
});
Signals.addSignalMethods(PreviewFullscreenToolbar.prototype);
