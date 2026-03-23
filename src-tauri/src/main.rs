// Empêcher l'ouverture d'une console Windows en production
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    server_manager_lib::run();
}
