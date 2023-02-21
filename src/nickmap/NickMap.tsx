import { Map as OpenLayersMap } from 'ol';
import Collection from 'ol/Collection';
import { Rotate, ScaleLine } from 'ol/control';
import { platformModifierKeyOnly } from 'ol/events/condition';
import GeoJSON from 'ol/format/GeoJSON';
import { DragBox, Select } from 'ol/interaction';
import { Group as LayerGroup } from 'ol/layer';
import VectorLayer from 'ol/layer/Vector';
import { fromLonLat } from 'ol/proj';
import VectorSource from 'ol/source/Vector';
import Stroke from 'ol/style/Stroke';
import Style from 'ol/style/Style';
import View from 'ol/View';

import powerbi from "powerbi-visuals-api";

import { useEffect, useRef } from 'react';

import {
    get_layer_state_road_ticks,
    layer_arcgis_rest,
    layer_open_street_map,
    layer_state_road,
    layer_wmts
} from './layers';

import "./nickmap.css";
import { NickMapControls } from './NickMapControls';
import { goto_google_maps, goto_google_street_view } from './util/goto_google';
import IVisualHost = powerbi.extensibility.visual.IVisualHost;

import * as React from "react";
import { NickmapFeatureCollection } from '../NickmapFeatures';
import { zoom_to_road_slk_state_type } from './zoom_to_road_slk_state_type';
import { ITooltipServiceWrapper } from 'powerbi-visuals-utils-tooltiputils';
import { feature_tooltip_items } from '../dataview_table_helpers';

type NickMapProps = {
    
    children:any[]
    version_text:string
    host:IVisualHost // good change to try context provider

    layer_wmts_url:string
    layer_wmts_show:boolean
    set_layer_wmts_show:(new_value:boolean)=>void

    layer_arcgis_rest_url:string
    layer_arcgis_rest_show:boolean
    set_layer_arcgis_rest_show:(new_value:boolean)=>void

    feature_collection:NickmapFeatureCollection
    feature_collection_request_count:number

    auto_zoom:boolean
    set_auto_zoom:(new_value:boolean)=>void

    selection:powerbi.extensibility.ISelectionId[],
    set_selection:(new_value:powerbi.extensibility.ISelectionId[])=>void

    tooltip_service:powerbi.extensibility.ITooltipService
    tooltip_service_wrapper: ITooltipServiceWrapper;
}

const default_map_view_settings = {
    zoom: 8,
    center: [12900824.756597541, -3758196.7323907884],
};

export function NickMap(props:NickMapProps){
    const [status_text, set_status_text] = React.useState("");
    const [zoom_to_road_slk_state, set_zoom_to_road_slk_state] = React.useState<zoom_to_road_slk_state_type>({type:"IDLE"})
    const vector_source_data_ref = useRef<VectorSource>(new VectorSource({}))
    const map_root_ref = useRef<HTMLDivElement>();
    const select_interaction_ref = useRef<Select>(null)
    const map_ref = useRef(new OpenLayersMap({
        controls:[
            new Rotate(),
            new ScaleLine()
        ],
        view:new View(default_map_view_settings)
    }))

    // ===============================
    // CLEAR SELECTION ON EVERY UPDATE
    // ===============================
    if(select_interaction_ref.current){
        select_interaction_ref.current.getFeatures().clear();
    }
    // =====
    // MOUNT
    // =====
    useEffect(()=>{
        let map = map_ref.current;
        map.setTarget(map_root_ref.current);
        let vector_layer_data = new VectorLayer({
            source:vector_source_data_ref.current,
            style:(item) => new Style({
                stroke:new Stroke({
                    width:2.5,
                    color:item.getProperties()["colour"]
                })
            })
        })
        select_interaction_ref.current = new Select({
            layers:[vector_layer_data],
            style:item => [
                new Style({
                    stroke:new Stroke({
                        width:8,
                        color:"white"
                    })
                }),
                new Style({
                    stroke:new Stroke({
                        width:2.5,
                        color:item.getProperties()["colour"]
                    })
                })
            ]
        });
        map.addInteraction(select_interaction_ref.current);
        const drag_interaction = new DragBox({condition:platformModifierKeyOnly})
        map.addInteraction(drag_interaction);
        drag_interaction.on('boxstart', function (event) {
            select_interaction_ref.current.getFeatures().clear();
        });
        drag_interaction.on('boxend', function (event) {
            const extent = drag_interaction.getGeometry().getExtent();
            const boxFeatures = vector_source_data_ref.current
                .getFeaturesInExtent(extent)
                .filter((feature) => feature.getGeometry().intersectsExtent(extent));
            // features that intersect the box geometry are added to the
            // collection of selected features

            // if the view is not obliquely rotated the box geometry and
            // its extent are equalivalent so intersecting features can
            // be added directly to the collection
            debugger
            const rotation = map.getView().getRotation();
            const oblique = rotation % (Math.PI / 2) !== 0;

            // when the view is obliquely rotated the box extent will
            // exceed its geometry so both the box and the candidate
            // feature geometries are rotated around a common anchor
            // to confirm that, with the box geometry aligned with its
            // extent, the geometries intersect
            if (oblique) {
                const anchor = [0, 0];
                const geometry = drag_interaction.getGeometry().clone();
                geometry.rotate(-rotation, anchor);
                const extent = geometry.getExtent();
                boxFeatures.forEach(function (feature) {
                    const geometry = feature.getGeometry().clone();
                    geometry.rotate(-rotation, anchor);
                    if (geometry.intersectsExtent(extent)) {
                        select_interaction_ref.current.getFeatures().push(feature);
                        props.set_selection(select_interaction_ref.current.getFeatures().getArray().map(item=>item.get("selection_id")))
                    }
                });
            } else {
                select_interaction_ref.current.getFeatures().extend(boxFeatures);
                props.set_selection(select_interaction_ref.current.getFeatures().getArray().map(item=>item.get("selection_id")))
            }
        });
        
        select_interaction_ref.current.on("select", e => {
            if((e.mapBrowserEvent.originalEvent as MouseEvent).isTrusted) // TODO: is this check needed?
            //console.log("TODO MOUNT - Select Interaction on Select")
            props.set_selection(e.selected.map(item=>item.get("selection_id")))
            //props.tooltip_service_wrapper.addTooltip()
            let selected_item_tooltips:feature_tooltip_items[] = e.selected.map(item=>item.get("tooltips"))
            if(selected_item_tooltips.length===1){
                props.tooltip_service.show({
                    coordinates:[
                        e.mapBrowserEvent.originalEvent.clientX,
                        e.mapBrowserEvent.originalEvent.clientY
                    ],
                    dataItems:selected_item_tooltips[0].map(item=>({
                        displayName: item.column_name,
                        value: String(item.value),
                        color: "",
                        header: ""
                    })),
                    isTouchEvent:e.mapBrowserEvent.originalEvent?.pointerType==="touch",
                    identities:e.selected.map(item=>item.get("selection_id"))
                })
            }
        })
        
        
        // Build map
        let road_network_layer_group = new LayerGroup({
            layers:[
                layer_state_road,
                get_layer_state_road_ticks(map),
            ]
        });
        
        map.setLayers(new Collection([
            new LayerGroup({
                layers:[
                    layer_open_street_map,
                    layer_arcgis_rest,
                    layer_wmts,
                ]
            }),
            road_network_layer_group,
            vector_layer_data,
        ]))

        map.getViewport().addEventListener("dragenter",function(event){
            event.dataTransfer.dropEffect = "move";
        })
        map.getViewport().addEventListener("dragover",function(event){
            event.preventDefault();
        })
        map.getViewport().addEventListener("drop", function(event){
            let target:HTMLDivElement = event.target as HTMLDivElement;
            if (event.dataTransfer.getData("Text")==="the pegman commeth!"){
                let rec = target.getBoundingClientRect();
                let px = [
                    event.clientX - rec.left,
                    event.clientY - rec.top
                ];
                let loc = map.getCoordinateFromPixel(px) as [number,number]
                goto_google_street_view(loc, props.host);
            }
        });
        set_status_text(build_status_feature_count(props.feature_collection.features.length,props.feature_collection_request_count))
        render_features_helper(vector_source_data_ref.current, props.feature_collection, map_ref.current);
    },[]);

    // =====================
    // SYNCHRONIZE SELECTION
    // =====================
    // useEffect(()=>{
    //     if(!select_interaction_ref.current) return; // TODO: check if this happens... it should not.
    //     let selected_features = select_interaction_ref.current.getFeatures()
        
    //     selected_features.clear()
    //     for(let feature_selection_id of props.selection){
    //         console.log("TODO: SYNCHRONISE SELECTION")
    //         //selected_features.push(vector_source_data_ref.current.getFeatureById(feature_selection_id as any))
    //     }
    // },[props.selection, props.set_selection, select_interaction_ref.current,vector_source_data_ref.current])

    // ============================
    // WMTS RASTER LAYER VISIBILITY
    // ============================
    useEffect(()=>{
        if (props.layer_wmts_url && props.layer_wmts_show){
            layer_wmts.getSource().setUrl(props.layer_wmts_url)
            layer_wmts.setVisible(true)
        }else{
            layer_wmts.setVisible(false)
        }
    },[props.layer_wmts_url, props.layer_wmts_show])

    // ==============================
    // ARCGIS RASTER LAYER VISIBILITY
    // ==============================
    useEffect(()=>{
        if (props.layer_arcgis_rest_url && props.layer_arcgis_rest_show){
            layer_arcgis_rest.getSource().setUrl(props.layer_arcgis_rest_url)
            layer_arcgis_rest.setVisible(true)
        }else{
            layer_arcgis_rest.setVisible(false)
        }
    },[props.layer_arcgis_rest_url, props.layer_arcgis_rest_show])

    // =======================
    // UPDATE VISIBLE FEATURES
    // =======================
    useEffect(()=>{
        render_features_helper(
            vector_source_data_ref.current,
            props.feature_collection,
            map_ref.current,
            props.auto_zoom
        );
        set_status_text(build_status_feature_count(props.feature_collection.features.length,props.feature_collection_request_count))
    },[props.feature_collection])

    // ==============
    // ZOOM TO EXTENT
    // ==============
    const zoom_to_extent = React.useCallback(()=>{
        if(vector_source_data_ref.current.getFeatures().length===0){
            set_view_properties(
                map_ref.current,
                default_map_view_settings.zoom,
                default_map_view_settings.center
            )
        }else{
            map_ref.current.getView().fit(vector_source_data_ref.current.getExtent())
        }
    },[map_ref.current, vector_source_data_ref.current])

    // ==================
    // ZOOM TO ROAD / SLK
    // ==================
    const zoom_to_road_slk = React.useCallback(async (road_number:string, slk:number)=>{
        console.log(`Zoom to ${road_number} ${slk}`)
        set_zoom_to_road_slk_state({"type":"PENDING"})
        let response = await fetch(
            `https://linref.thehappycheese.com/?road=${road_number}&slk=${slk}&f=latlon`,
            {
                mode:"cors"
            }
        );
        if(response.ok){
            let response_text = await response.text();
            let [lat,lon] = response_text.split(",");
            set_view_properties(
                map_ref.current,
                18,//props.auto_zoom ? 18 : map_ref.current.getView().getZoom(),
                fromLonLat([parseFloat(lon),parseFloat(lat)])
            )
            set_zoom_to_road_slk_state({type:"SUCCESS"})
        }else{
            console.log(`FAILED: Zoom to ${road_number} ${slk}; Server responded ${response.status} ${response.statusText}`)
            set_zoom_to_road_slk_state({type:"FAILED", reason:`${road_number} ${slk.toFixed(3)} not found.`})
            // TODO: notify user
        }
    },[map_ref.current, set_zoom_to_road_slk_state])

    // ======
    // RENDER
    // ======
    return <div className="nickmap-controls-map-container">
        <NickMapControls
            on_go_to_google_maps={()=>{
                let center = map_ref.current.getView().getCenter();
                let zoom = map_ref.current.getView().getZoom();
                goto_google_maps(center, zoom, props.host)
            }}

            layer_wmts_url={props.layer_wmts_url}
            layer_wmts_show={props.layer_wmts_show}
            set_layer_wmts_show={props.set_layer_wmts_show}

            layer_arcgis_rest_url={props.layer_arcgis_rest_url}
            layer_arcgis_rest_show={props.layer_arcgis_rest_show}
            set_layer_arcgis_rest_show={props.set_layer_arcgis_rest_show}
            
            on_zoom_to_extent={zoom_to_extent}
            on_zoom_to_road_slk={zoom_to_road_slk}
            zoom_to_road_slk_state={zoom_to_road_slk_state}
            auto_zoom={props.auto_zoom}
            set_auto_zoom={props.set_auto_zoom}

        />
        <div className="nickmap-status-version-display">
            <div className="nickmap-status-text" title={status_text}>{status_text}</div>
            <div className="nickmap-version-text" title={props.version_text}>{props.version_text}</div>
        </div>
        <div ref={map_root_ref} className="nickmap-map-host"></div>
    </div>
}

/**
 * This function is used because `map.getView().setProperties()` does not work as expected
 * it is pretty annoying
 */
function set_view_properties(map:OpenLayersMap, zoom:number, center:number[]){
    let view = map.getView();
    view.setZoom(zoom);
    view.setCenter(center);
}

function build_status_feature_count(features_count, features_requested_count){
    if(features_count===features_requested_count){
        return `Showing ${features_count} features`
    }else{
        return `Showing ${features_count} of ${features_requested_count} features`
    }
}

function render_features_helper(
    vector_source_data:VectorSource,
    feature_collection:NickmapFeatureCollection,
    map:OpenLayersMap,
    zoom_to_extent = true
){
    vector_source_data.clear()
    if (feature_collection.features.length > 0){
        let features = new GeoJSON().readFeatures(feature_collection, {
            featureProjection:"EPSG:3857", // target: openlayers default projection
            dataProjection:"EPSG:4326", // source: geojson exclusively uses WGS84 which is known as 4326 in the EPSG system
        })
        vector_source_data.addFeatures(features)
        if(zoom_to_extent){
            map.getView().fit(vector_source_data.getExtent())
        }
    }
}
// class defunct{
//     update_render_count(count_features:number, count_null:number){
//         if(count_null){
//             this.controls.set_status(`Showing ${count_features-count_null} of ${count_features}. <span style="color:#822;">Some rows were not rendered due to invalid road_number, slk_from or slk_to.</span>`)
//         }else{
//             this.controls.set_status(`Showing ${count_features} features`)
//         }
//     }
//     replace_features(geojson:{type:"FeatureCollection", features:any[]}, colours:string[]){
//         
//         this.update_render_count(geojson.features.length, null_count);
//         
//     }
//     
// }