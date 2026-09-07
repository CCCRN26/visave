'use client';
import { useState } from 'react';
import DependentLocationFields from './dependent-location-fields';
export default function LocationFilterFields({states,initialStateId='',initialLgaId=''}){const[value,setValue]=useState({stateId:initialStateId,lgaId:initialLgaId,communityId:''});return <DependentLocationFields states={states} value={value} onChange={setValue} includeCommunity={false}/>}
